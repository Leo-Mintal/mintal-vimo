package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

const maxRequestBodyBytes = 1 << 20

func withSecurity(options RouterOptions, next http.Handler) http.Handler {
	allowedOrigins := allowedOriginSet(options.AllowedOrigins)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !applyCORS(w, r, allowedOrigins) {
			writeError(w, http.StatusForbidden, "origin is not allowed")
			return
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Vimo-Api-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if options.RequireAPIToken && !validAPIToken(r, options.APIToken) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func applyCORS(w http.ResponseWriter, r *http.Request, allowedOrigins map[string]struct{}) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	if _, ok := allowedOrigins[origin]; !ok {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	return true
}

func validAPIToken(r *http.Request, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return false
	}
	candidates := []string{
		strings.TrimSpace(r.Header.Get("X-Vimo-Api-Token")),
		bearerToken(r.Header.Get("Authorization")),
	}
	for _, candidate := range candidates {
		if candidate == "" || len(candidate) != len(expected) {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(expected)) == 1 {
			return true
		}
	}
	return false
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if len(header) < len("Bearer ") || !strings.EqualFold(header[:len("Bearer ")], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(header[len("Bearer "):])
}
