package main

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"net/http"
	"strconv"
	"time"
)

const (
	// backoffBase is both the first idle interval and the first retry delay.
	backoffBase = 5 * time.Second
	// backoffCeiling is the longest either wait grows to before jitter.
	backoffCeiling = 60 * time.Second
	// backoffJitter spreads waits so several watchers sharing an account do not
	// line up on the same second. A healthy idle poll is therefore 5 to 72
	// seconds: the ceiling plus a fifth of it.
	backoffJitter = 0.2
)

// backoff doubles a wait up to a ceiling and adds jitter. Idle waiting and
// failure waiting each own one, because finding work and reaching the server
// are different things to recover from.
type backoff struct {
	base    time.Duration
	ceiling time.Duration
	jitter  float64
	// random returns a value in [0,1). It is a field so a test can be exact.
	random   func() float64
	attempts int
}

func newBackoff() *backoff {
	return &backoff{base: backoffBase, ceiling: backoffCeiling, jitter: backoffJitter, random: randomFraction}
}

func (b *backoff) reset() { b.attempts = 0 }

// next returns the wait to use now and advances the sequence.
func (b *backoff) next() time.Duration {
	wait := b.base
	// Shifting past the ceiling is pointless and would overflow on a long run.
	for i := 0; i < b.attempts && wait < b.ceiling; i++ {
		wait *= 2
	}
	if wait > b.ceiling {
		wait = b.ceiling
	}
	b.attempts++
	spread := time.Duration(float64(wait) * b.jitter * b.random())
	return wait + spread
}

// randomFraction draws from the system source. Jitter only has to be spread
// out, not unguessable, but there is no reason to seed a weaker generator.
func randomFraction() float64 {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return 0
	}
	return float64(binary.BigEndian.Uint64(raw[:])>>11) / float64(1<<53)
}

// retryDelay decides whether a failed read is worth repeating and how long to
// wait. A rate limit that names its own delay is honored; anything else uses
// the caller's failure sequence.
func retryDelay(err error, failure *backoff) (time.Duration, bool) {
	if !retryableError(err) {
		return 0, false
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		// A connection failure or timeout never reached a decision, so it is
		// always worth another try.
		return failure.next(), true
	}
	// The sequence always advances, even when the server names its own delay,
	// so a zero or tiny hint cannot turn a rate limit into a request flood.
	wait := failure.next()
	if apiErr.Status == http.StatusTooManyRequests {
		if hinted, ok := retryAfterDelay(apiErr.RetryAfter); ok && hinted > wait {
			return hinted, true
		}
	}
	return wait, true
}

// retryableError reports whether waiting could plausibly change the answer. It
// is the single place that classification lives, so a caller that only needs
// the yes or no does not have to advance a backoff sequence to ask.
func retryableError(err error) bool {
	if errors.Is(err, context.Canceled) {
		// The caller stopped, which is not a failure to wait out. A deadline is
		// deliberately not included: the only deadline in play is the HTTP
		// client's own timeout, so treating it as terminal would let one slow
		// response stop a run.
		return false
	}
	var request *requestBuildError
	if errors.As(err, &request) {
		// The address itself is wrong. No amount of waiting fixes a bad URL.
		return false
	}
	var format *responseFormatError
	if errors.As(err, &format) {
		// The reply was not the API's. A proxy serving an error page will keep
		// serving it, so waiting achieves nothing.
		return false
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		// A connection failure or timeout never reached a decision.
		return true
	}
	// Everything else is terminal for this operation, including the 400, 401,
	// 403, 404 and 409 the design names and any status outside the retryable
	// set. Repeating a decision the server has already made cannot change it.
	return retryableStatuses[apiErr.Status]
}

// retryAfterDelay reads the delta-seconds form of Retry-After. The HTTP-date
// form is ignored rather than guessed at, and an absurd value is not allowed to
// park the watcher for a day. A hint only ever delays the next request: it is
// compared against the failure sequence and the longer of the two wins, so a
// zero or one-second hint from a misconfigured proxy cannot become a flood
// aimed at an account that is already rate limited.
func retryAfterDelay(value string) (time.Duration, bool) {
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds < 0 {
		return 0, false
	}
	if seconds > int(maxRetryAfter/time.Second) {
		return maxRetryAfter, true
	}
	return time.Duration(seconds) * time.Second, true
}

// maxRetryAfter caps how long a server may park the watcher.
const maxRetryAfter = 5 * time.Minute

// healthyIdleBounds reports the range a healthy idle poll must stay inside, for
// the test that pins the design's stated numbers.
func healthyIdleBounds() (time.Duration, time.Duration) {
	return backoffBase, backoffCeiling + time.Duration(float64(backoffCeiling)*backoffJitter)
}
