package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func LoadSystemPrompt(root string) (string, error) {
	return loadAgentPromptWithAlwaysSkills(root, []string{"prompts", "agent", "analyze"})
}

func LoadFastReplyPrompt(root string) (string, error) {
	return loadAgentPromptWithAlwaysSkills(root, []string{"prompts", "agent", "fast-reply"})
}

func loadAgentPromptWithAlwaysSkills(root string, agentPath []string) (string, error) {
	agentSections, err := loadPromptSections(root, agentPath...)
	if err != nil {
		return "", err
	}
	alwaysSections, err := loadOptionalPromptSections(root, "prompts", "skills", "always")
	if err != nil {
		return "", err
	}
	sections := make([]string, 0, len(agentSections)+len(alwaysSections))
	if len(agentSections) > 0 {
		sections = append(sections, agentSections[0])
		sections = append(sections, alwaysSections...)
		sections = append(sections, agentSections[1:]...)
	} else {
		sections = append(sections, alwaysSections...)
	}
	return strings.Join(sections, "\n\n---\n\n"), nil
}

func loadPromptDirectory(root string, path ...string) (string, error) {
	sections, err := loadPromptSections(root, path...)
	if err != nil {
		return "", err
	}
	return strings.Join(sections, "\n\n---\n\n"), nil
}

func loadOptionalPromptSections(root string, path ...string) ([]string, error) {
	dir := filepath.Join(append([]string{root}, path...)...)
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read optional prompt directory: %w", err)
	}
	return loadPromptSections(root, path...)
}

func loadPromptSections(root string, path ...string) ([]string, error) {
	dir := filepath.Join(append([]string{root}, path...)...)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read agent prompt directory: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".md" || strings.EqualFold(entry.Name(), "README.md") {
			continue
		}
		files = append(files, entry.Name())
	}
	sort.Strings(files)
	if len(files) == 0 {
		return nil, fmt.Errorf("no agent prompt files found in %s", dir)
	}

	sections := make([]string, 0, len(files))
	for _, file := range files {
		content, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			return nil, fmt.Errorf("read prompt file %s: %w", file, err)
		}
		section := strings.TrimSpace(string(content))
		if section == "" {
			continue
		}
		sections = append(sections, section)
	}
	if len(sections) == 0 {
		return nil, fmt.Errorf("agent prompt files are empty in %s", dir)
	}

	return sections, nil
}
