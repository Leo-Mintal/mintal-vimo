package agent

import (
	"fmt"
	"sort"
	"strings"

	"mintal-vimo/vimo-go/internal/config"
	"mintal-vimo/vimo-go/internal/llm"
	"mintal-vimo/vimo-go/internal/llm/qwen"
)

type ModelRegistry struct {
	activeKey string
	options   []ModelOption
	providers map[string]llm.Provider
}

func NewModelRegistry(modelConfig config.ModelConfig) (*ModelRegistry, error) {
	if strings.TrimSpace(modelConfig.ActiveProvider) == "" {
		return nil, fmt.Errorf("active provider is required")
	}

	keys := make([]string, 0, len(modelConfig.Providers))
	for key := range modelConfig.Providers {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	options := make([]ModelOption, 0, len(keys))
	providers := map[string]llm.Provider{}
	for _, key := range keys {
		providerConfig := modelConfig.Providers[key]
		if providerConfig.Type != "openai_compatible" {
			return nil, fmt.Errorf("unsupported model provider type %q for %q", providerConfig.Type, key)
		}
		label := strings.TrimSpace(providerConfig.Label)
		if label == "" {
			label = key
		}
		options = append(options, ModelOption{
			Key:              key,
			Label:            label,
			Description:      strings.TrimSpace(providerConfig.Description),
			Model:            providerConfig.ChatModel,
			Default:          key == modelConfig.ActiveProvider,
			SupportsThinking: providerConfig.SupportsThinking,
		})
		providers[key] = qwen.NewClient(providerConfig)
	}
	if _, ok := providers[modelConfig.ActiveProvider]; !ok {
		return nil, fmt.Errorf("active provider %q is not configured", modelConfig.ActiveProvider)
	}
	return &ModelRegistry{
		activeKey: modelConfig.ActiveProvider,
		options:   options,
		providers: providers,
	}, nil
}

func (r *ModelRegistry) Provider(key string) (llm.Provider, string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = r.activeKey
	}
	provider, ok := r.providers[key]
	if !ok {
		return nil, "", fmt.Errorf("model %q is not configured", key)
	}
	return provider, key, nil
}

func (r *ModelRegistry) Options() []ModelOption {
	options := make([]ModelOption, len(r.options))
	copy(options, r.options)
	return options
}
