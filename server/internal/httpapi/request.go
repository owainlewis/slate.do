package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const (
	MaxJSONBodyBytes = 64 * 1024

	TaskTitleRunes         = 300
	TaskDescriptionBytes   = 16 * 1024
	BoardNameRunes         = 100
	BoardBackgroundRunes   = 100
	BoardBackgroundKind    = 32
	ListNameRunes          = 100
	ListGoalBytes          = 4 * 1024
	AgentNameRunes         = 100
	AgentInstructionsBytes = 4 * 1024
	APITokenNameRunes      = 80
	DisplayNameRunes       = 80
	EmailBytes             = 254
	TaskIdempotencyBytes   = 200
	AgentRotationKeyBytes  = 128
)

func DecodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	if r.ContentLength > MaxJSONBodyBytes {
		writeCodedError(w, http.StatusRequestEntityTooLarge, "request_body_too_large", fmt.Sprintf("JSON request body must be %d bytes or fewer.", MaxJSONBodyBytes))
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxJSONBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeDecodeError(w, err)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeDecodeError(w, err)
		return false
	}
	return true
}

func RuneLimit(w http.ResponseWriter, field string, value string, limit int) bool {
	if len([]rune(value)) <= limit {
		return true
	}
	writeFieldLimit(w, field, limit, "characters")
	return false
}

func ByteLimit(w http.ResponseWriter, field string, value string, limit int) bool {
	if len([]byte(value)) <= limit {
		return true
	}
	writeFieldLimit(w, field, limit, "UTF-8 bytes")
	return false
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeCodedError(w, http.StatusRequestEntityTooLarge, "request_body_too_large", fmt.Sprintf("JSON request body must be %d bytes or fewer.", MaxJSONBodyBytes))
		return
	}
	writeCodedError(w, http.StatusBadRequest, "invalid_json", "Invalid JSON body.")
}

func writeFieldLimit(w http.ResponseWriter, field string, limit int, unit string) {
	writeJSON(w, http.StatusBadRequest, struct {
		Code  string `json:"code"`
		Error string `json:"error"`
		Field string `json:"field"`
		Limit int    `json:"limit"`
		Unit  string `json:"unit"`
	}{
		Code:  "field_too_long",
		Error: fmt.Sprintf("%s must be %d %s or fewer.", field, limit, unit),
		Field: field,
		Limit: limit,
		Unit:  unit,
	})
}

func writeCodedError(w http.ResponseWriter, status int, code string, message string) {
	writeJSON(w, status, map[string]string{"code": code, "error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
