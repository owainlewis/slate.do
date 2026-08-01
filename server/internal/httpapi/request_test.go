package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONAcceptsExactBodyLimitAndRejectsOneByteOver(t *testing.T) {
	base := `{"name":"ok"}`
	for _, test := range []struct {
		name   string
		size   int
		status int
		ok     bool
		code   string
		stream bool
	}{
		{name: "exact", size: MaxJSONBodyBytes, status: http.StatusOK, ok: true},
		{name: "one over", size: MaxJSONBodyBytes + 1, status: http.StatusRequestEntityTooLarge, code: `"code":"request_body_too_large"`},
		{name: "streamed one over", size: MaxJSONBodyBytes + 1, status: http.StatusRequestEntityTooLarge, code: `"code":"request_body_too_large"`, stream: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := base + strings.Repeat(" ", test.size-len(base))
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
			if test.stream {
				req.ContentLength = -1
			}
			recorder := httptest.NewRecorder()
			var input struct {
				Name string `json:"name"`
			}
			if got := DecodeJSON(recorder, req, &input); got != test.ok {
				t.Fatalf("DecodeJSON() = %v, want %v; body = %s", got, test.ok, recorder.Body.String())
			}
			if test.ok && input.Name != "ok" {
				t.Fatalf("name = %q", input.Name)
			}
			if !test.ok && (recorder.Code != test.status || !strings.Contains(recorder.Body.String(), test.code)) {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestTextLimitsCountRunesAndUTF8Bytes(t *testing.T) {
	for _, test := range []struct {
		name  string
		check func(http.ResponseWriter, string, string, int) bool
		value string
		limit int
		ok    bool
	}{
		{name: "runes exact", check: RuneLimit, value: strings.Repeat("🙂", 3), limit: 3, ok: true},
		{name: "runes one over", check: RuneLimit, value: strings.Repeat("🙂", 4), limit: 3},
		{name: "bytes exact", check: ByteLimit, value: strings.Repeat("🙂", 3), limit: 12, ok: true},
		{name: "bytes one over", check: ByteLimit, value: strings.Repeat("🙂", 4), limit: 12},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if got := test.check(recorder, "field", test.value, test.limit); got != test.ok {
				t.Fatalf("check() = %v, want %v", got, test.ok)
			}
			if !test.ok {
				body := recorder.Body.String()
				if recorder.Code != http.StatusBadRequest || !strings.Contains(body, `"code":"field_too_long"`) || !strings.Contains(body, `"field":"field"`) || strings.Contains(body, test.value) {
					t.Fatalf("status = %d, body = %s", recorder.Code, body)
				}
			}
		})
	}
}
