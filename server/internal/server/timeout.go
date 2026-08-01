package server

import (
	"net/http"
	"time"
)

const requestTimeoutResponse = `{"code":"service_unavailable","error":"Request timed out."}`

func WithRequestTimeout(next http.Handler, timeout time.Duration) http.Handler {
	timed := http.TimeoutHandler(next, timeout, requestTimeoutResponse)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		timed.ServeHTTP(serviceUnavailableContentTypeWriter{ResponseWriter: w}, r)
	})
}

type serviceUnavailableContentTypeWriter struct {
	http.ResponseWriter
}

func (w serviceUnavailableContentTypeWriter) WriteHeader(status int) {
	if status == http.StatusServiceUnavailable && w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.ResponseWriter.WriteHeader(status)
}
