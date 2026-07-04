package httpapi

import (
	"net/http"
	"strings"

	"mintal-vimo/vimo-go/internal/config"
)

type RouterOptions struct {
	AllowedOrigins  []string
	RequireAPIToken bool
	APIToken        string
}

func RouterOptionsFromApp(app *config.App) RouterOptions {
	if app == nil {
		return RouterOptions{}
	}
	return RouterOptions{
		AllowedOrigins:  app.AllowedOrigins,
		RequireAPIToken: app.RequireAPIToken,
		APIToken:        app.APIToken,
	}
}

func NewRouter(handler *Handler, options ...RouterOptions) http.Handler {
	if len(options) > 0 {
		return newRouter(handler, options[0])
	}
	return newRouter(handler, RouterOptions{})
}

func newRouter(handler *Handler, routerOptions RouterOptions) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", handler.Health)
	mux.HandleFunc("/api/agent/models", handler.AgentModels)
	mux.HandleFunc("/api/agent/fast-reply/stream", handler.AgentFastReplyStream)
	mux.HandleFunc("/api/agent/messages/stream", handler.AgentMessageStream)
	mux.HandleFunc("/api/agent/messages", handler.AgentMessage)
	mux.HandleFunc("/api/records", handler.Records)
	mux.HandleFunc("/api/records/", handler.RecordByID)
	return withSecurity(routerOptions, mux)
}

func allowedOriginSet(origins []string) map[string]struct{} {
	set := map[string]struct{}{}
	for _, origin := range origins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			set[origin] = struct{}{}
		}
	}
	return set
}
