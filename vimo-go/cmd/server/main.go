package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"mintal-vimo/vimo-go/internal/agent"
	"mintal-vimo/vimo-go/internal/config"
	httpapi "mintal-vimo/vimo-go/internal/http"
	"mintal-vimo/vimo-go/internal/records"
)

func main() {
	root, err := vimoGoRoot()
	if err != nil {
		log.Fatal(err)
	}

	appConfig, err := config.Load(root)
	if err != nil {
		log.Fatal(err)
	}
	if err := validateRuntimeSecurity(appConfig); err != nil {
		log.Fatal(err)
	}
	modelRegistry, err := agent.NewModelRegistry(appConfig.ModelConfig)
	if err != nil {
		log.Fatal(err)
	}

	systemPrompt, err := agent.LoadSystemPrompt(root)
	if err != nil {
		log.Fatal(err)
	}
	fastReplyPrompt, err := agent.LoadFastReplyPrompt(root)
	if err != nil {
		log.Fatal(err)
	}
	agentService := agent.NewServiceWithPrompts(modelRegistry, systemPrompt, fastReplyPrompt)

	recordRepo, cleanupRecords, err := newRecordRepository(context.Background(), appConfig)
	if err != nil {
		log.Fatal(err)
	}
	if cleanupRecords != nil {
		defer cleanupRecords()
	}
	recordsService := records.NewService(recordRepo)
	handler := httpapi.NewHandler(agentService, recordsService)

	addr := appConfig.HTTPHost + ":" + appConfig.HTTPPort
	log.Printf("Vimo Go listening on http://%s", addr)
	server := &http.Server{
		Addr:              addr,
		Handler:           httpapi.NewRouter(handler, httpapi.RouterOptionsFromApp(appConfig)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func validateRuntimeSecurity(appConfig *config.App) error {
	if appConfig == nil {
		return fmt.Errorf("app config is required")
	}
	env := strings.ToLower(strings.TrimSpace(appConfig.Env))
	host := strings.TrimSpace(appConfig.HTTPHost)
	if host == "" {
		return fmt.Errorf("HTTP_HOST is required")
	}
	exposedHost := host == "0.0.0.0" || host == "::" || host == "[::]"
	if (env != "local" || exposedHost) && !appConfig.RequireAPIToken {
		return fmt.Errorf("REQUIRE_API_TOKEN=true is required when APP_ENV is not local or HTTP_HOST is externally reachable")
	}
	if appConfig.RequireAPIToken && strings.TrimSpace(appConfig.APIToken) == "" {
		return fmt.Errorf("API_TOKEN is required when REQUIRE_API_TOKEN=true")
	}
	return nil
}

func newRecordRepository(ctx context.Context, appConfig *config.App) (records.Repository, func(), error) {
	switch appConfig.Database.Driver {
	case "", "memory":
		log.Print("Records repository: memory")
		return records.NewMemoryRepository(), nil, nil
	case "mysql":
		repo, err := records.NewMySQLRepository(ctx, appConfig.Database.DSN)
		if err != nil {
			return nil, nil, err
		}
		log.Print("Records repository: mysql")
		return repo, func() {
			if err := repo.Close(); err != nil {
				log.Printf("close mysql repository: %v", err)
			}
		}, nil
	default:
		return nil, nil, fmt.Errorf("unsupported DB_DRIVER %q", appConfig.Database.Driver)
	}
}

func vimoGoRoot() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	if filepath.Base(cwd) == "vimo-go" {
		return cwd, nil
	}
	if _, err := os.Stat(filepath.Join(cwd, "vimo-go", "go.mod")); err == nil {
		return filepath.Join(cwd, "vimo-go"), nil
	}
	return "", fmt.Errorf("vimo-go root not found from %s", cwd)
}
