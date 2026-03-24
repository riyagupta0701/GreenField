package handlers

import (
	"encoding/json"
	"net/http"
)

// Pattern B (fieldExtractor): map[string]interface{} literal in handler
func VersionHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"version": "1.0",
	})
}

// Pattern B (fieldExtractor): map[string]any variant assigned to variable
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	resp := map[string]any{
		"healthy": true,
		"uptime":  9999,
	}
	json.NewEncoder(w).Encode(resp)
}

// Pattern B (usageTracker): json.NewDecoder(r.Body).Decode
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	json.NewDecoder(r.Body).Decode(&req)
	json.NewEncoder(w).Encode(map[string]interface{}{"token": "xyz"})
}

// Pattern C+D (usageTracker): r.URL.Query().Get and r.FormValue
func SearchHandler(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("search")
	filter := r.FormValue("filter")
	_ = search
	_ = filter
	json.NewEncoder(w).Encode(map[string]interface{}{"results": []string{}})
}
