package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type App struct {
	Env             string
	HTTPHost        string
	HTTPPort        string
	AllowedOrigins  []string
	RequireAPIToken bool
	APIToken        string
	Database        DatabaseConfig
	ModelConfig     ModelConfig
}

type DatabaseConfig struct {
	Driver string
	DSN    string
}

type ModelConfig struct {
	ActiveProvider string
	Providers      map[string]ProviderConfig
}

type ProviderConfig struct {
	Type           string
	Label          string
	Description    string
	BaseURL        string
	APIKey         string
	ChatModel      string
	TimeoutSeconds int
	DefaultParams  ModelParams
}

type ModelParams struct {
	Temperature *float64
	TopP        *float64
	MaxTokens   *int
	Stream      bool
}

func Load(root string) (*App, error) {
	loadDotEnv(filepath.Join(root, ".env"))

	modelConfigPath := envString("ACTIVE_MODEL_CONFIG", "./configs/models.yaml")
	if !filepath.IsAbs(modelConfigPath) {
		modelConfigPath = filepath.Join(root, modelConfigPath)
	}

	modelConfig, err := LoadModelConfig(modelConfigPath)
	if err != nil {
		modelConfig = defaultModelConfig()
	}

	return &App{
		Env:             envString("APP_ENV", "local"),
		HTTPHost:        envString("HTTP_HOST", "127.0.0.1"),
		HTTPPort:        envString("HTTP_PORT", "8080"),
		AllowedOrigins:  envList("ALLOWED_ORIGINS", []string{"http://localhost:5173", "http://127.0.0.1:5173"}),
		RequireAPIToken: envBool("REQUIRE_API_TOKEN", false),
		APIToken:        envString("API_TOKEN", ""),
		Database:        loadDatabaseConfig(),
		ModelConfig:     modelConfig,
	}, nil
}

func loadDatabaseConfig() DatabaseConfig {
	dsn := envString("MYSQL_DSN", "")
	driver := strings.TrimSpace(strings.ToLower(envString("DB_DRIVER", "")))
	if driver == "" {
		driver = "memory"
	}
	return DatabaseConfig{
		Driver: driver,
		DSN:    dsn,
	}
}

func LoadModelConfig(path string) (ModelConfig, error) {
	file, err := os.Open(path)
	if err != nil {
		return ModelConfig{}, err
	}
	defer file.Close()

	cfg := ModelConfig{Providers: map[string]ProviderConfig{}}
	var currentProvider string
	inProviders := false
	inDefaultParams := false

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		raw := strings.TrimRight(scanner.Text(), " \t")
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		indent := leadingSpaces(raw)
		if indent == 0 {
			inDefaultParams = false
			currentProvider = ""
			if strings.HasPrefix(line, "active_provider:") {
				cfg.ActiveProvider = cleanValue(afterColon(line))
				continue
			}
			if line == "providers:" {
				inProviders = true
				continue
			}
		}

		if !inProviders {
			continue
		}

		if indent == 2 && strings.HasSuffix(line, ":") {
			currentProvider = strings.TrimSuffix(line, ":")
			cfg.Providers[currentProvider] = ProviderConfig{}
			inDefaultParams = false
			continue
		}

		if currentProvider == "" {
			continue
		}

		provider := cfg.Providers[currentProvider]
		if indent == 4 && line == "default_params:" {
			inDefaultParams = true
			cfg.Providers[currentProvider] = provider
			continue
		}

		key, value, ok := splitYAMLPair(line)
		if !ok {
			continue
		}
		value = expandValue(cleanValue(value))

		if inDefaultParams && indent >= 6 {
			switch key {
			case "temperature":
				if parsed, err := strconv.ParseFloat(value, 64); err == nil {
					provider.DefaultParams.Temperature = &parsed
				}
			case "top_p":
				if parsed, err := strconv.ParseFloat(value, 64); err == nil {
					provider.DefaultParams.TopP = &parsed
				}
			case "max_tokens":
				if parsed, err := strconv.Atoi(value); err == nil {
					provider.DefaultParams.MaxTokens = &parsed
				}
			case "stream":
				provider.DefaultParams.Stream = strings.EqualFold(value, "true")
			}
		} else if indent >= 4 {
			switch key {
			case "type":
				provider.Type = value
			case "label":
				provider.Label = value
			case "description":
				provider.Description = value
			case "base_url":
				provider.BaseURL = value
			case "api_key":
				provider.APIKey = value
			case "chat_model":
				provider.ChatModel = value
			case "timeout_seconds":
				if parsed, err := strconv.Atoi(value); err == nil {
					provider.TimeoutSeconds = parsed
				}
			}
		}

		cfg.Providers[currentProvider] = provider
	}
	if err := scanner.Err(); err != nil {
		return ModelConfig{}, err
	}
	if cfg.ActiveProvider == "" {
		return ModelConfig{}, fmt.Errorf("active_provider is required")
	}
	if _, ok := cfg.Providers[cfg.ActiveProvider]; !ok {
		return ModelConfig{}, fmt.Errorf("active provider %q is not configured", cfg.ActiveProvider)
	}
	return cfg, nil
}

func (c ModelConfig) Active() (ProviderConfig, error) {
	provider, ok := c.Providers[c.ActiveProvider]
	if !ok {
		return ProviderConfig{}, fmt.Errorf("active provider %q is not configured", c.ActiveProvider)
	}
	return provider, nil
}

func (c ModelConfig) Provider(key string) (ProviderConfig, bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = c.ActiveProvider
	}
	provider, ok := c.Providers[key]
	return provider, ok
}

func defaultModelConfig() ModelConfig {
	temp := 0.2
	topP := 0.8
	maxTokens := 2048
	return ModelConfig{
		ActiveProvider: "qwen_local",
		Providers: map[string]ProviderConfig{
			"qwen_local": {
				Type:           "openai_compatible",
				Label:          "Qwen3.5",
				Description:    "部署在本地、成本低，但上下文容量相对较小，适合对数据隐私敏感的场景。",
				BaseURL:        envString("QWEN_BASE_URL", "http://127.0.0.1:8001"),
				APIKey:         envString("QWEN_API_KEY", ""),
				ChatModel:      envString("QWEN_CHAT_MODEL", "qwen3.5-35b-text"),
				TimeoutSeconds: envInt("QWEN_TIMEOUT_SECONDS", 120),
				DefaultParams: ModelParams{
					Temperature: &temp,
					TopP:        &topP,
					MaxTokens:   &maxTokens,
					Stream:      false,
				},
			},
		},
	}
}

func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		os.Setenv(key, cleanValue(strings.TrimSpace(value)))
	}
}

func splitYAMLPair(line string) (string, string, bool) {
	key, value, ok := strings.Cut(line, ":")
	if !ok {
		return "", "", false
	}
	return strings.TrimSpace(key), strings.TrimSpace(value), true
}

func afterColon(line string) string {
	_, value, _ := strings.Cut(line, ":")
	return strings.TrimSpace(value)
}

func cleanValue(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "\"'")
	return value
}

func expandValue(value string) string {
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		return os.Getenv(strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}"))
	}
	return os.ExpandEnv(value)
}

func leadingSpaces(value string) int {
	count := 0
	for _, char := range value {
		if char != ' ' {
			return count
		}
		count++
	}
	return count
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func envList(key string, fallback []string) []string {
	raw := os.Getenv(key)
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value != "" {
			values = append(values, value)
		}
	}
	if len(values) == 0 {
		return fallback
	}
	return values
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
