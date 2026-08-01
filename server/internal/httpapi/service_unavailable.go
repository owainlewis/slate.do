package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/owainlewis/slate.do/server/internal/database"
)

func WriteServiceUnavailable(w http.ResponseWriter, err error) bool {
	if !database.IsCapacityError(err) {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":  "service_unavailable",
		"error": "Service capacity is temporarily unavailable.",
	})
	return true
}
