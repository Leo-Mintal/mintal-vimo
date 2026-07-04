package httpapi

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityRejectsDisallowedOrigin(t *testing.T) {
	handler := withSecurity(RouterOptions{
		AllowedOrigins: []string{"http://localhost:5173"},
	}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if resp.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusForbidden)
	}
	if resp.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty", resp.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestSecurityAllowsConfiguredOriginWithoutWildcard(t *testing.T) {
	handler := withSecurity(RouterOptions{
		AllowedOrigins: []string{"http://localhost:5173"},
	}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusOK)
	}
	if resp.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("Access-Control-Allow-Origin = %q", resp.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestSecurityRequiresAPIToken(t *testing.T) {
	handler := withSecurity(RouterOptions{
		RequireAPIToken: true,
		APIToken:        "secret",
	}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("status without token = %d, want %d", resp.Code, http.StatusUnauthorized)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Authorization", "Bearer secret")
	resp = httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("status with token = %d, want %d", resp.Code, http.StatusOK)
	}
}

func TestSecurityLimitsRequestBody(t *testing.T) {
	handler := withSecurity(RouterOptions{}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "request body is too large")
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	body := strings.NewReader(strings.Repeat("a", maxRequestBodyBytes+1))
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/api/records", body))

	if resp.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.Code, http.StatusBadRequest)
	}
}
