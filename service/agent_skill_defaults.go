package service

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/goccy/go-yaml"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

//go:embed skills
var defaultAgentSkillFS embed.FS

type defaultAgentSkillMetadata struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

type defaultAgentSkillPackage struct {
	Root        string
	Name        string
	Description string
	Content     string
	Files       []model.AgentSkillFile
}

// 这一版新增的默认 Skill。升级基线只补它；当时已经不在库里的旧默认 Skill 视为用户删过，不再自动加回。
const newlyAddedDefaultAgentSkillRoot = "skills/soul-street-outfit.md"

// EnsureDefaultAgentSkills 在数据库首次初始化时导入全部默认 Skill。
// 之后每次启动只补齐新增加的默认 Skill，不覆盖已有内容，也不恢复升级前已经缺失的旧默认 Skill。
func EnsureDefaultAgentSkills() error {
	initialized, err := repository.AgentSkillsInitialized()
	if err != nil {
		return err
	}
	if !initialized {
		existing, err := repository.ListSystemAgentSkills()
		if err != nil {
			return err
		}
		if len(existing) > 0 {
			if err := repository.MarkAgentSkillsInitialized(now()); err != nil {
				return err
			}
		} else if err := importDefaultAgentSkills(); err != nil {
			return err
		}
	}
	return syncMissingDefaultAgentSkills()
}

func importDefaultAgentSkills() error {
	packages, err := readDefaultAgentSkillPackages()
	if err != nil {
		return err
	}
	current := now()
	items := make([]model.AgentSkill, 0, len(packages))
	fileGroups := make([][]model.AgentSkillFile, 0, len(packages))
	for index, item := range packages {
		skill, files, err := newDefaultAgentSkill(item, index, current)
		if err != nil {
			return err
		}
		items = append(items, skill)
		fileGroups = append(fileGroups, files)
	}
	return repository.InitializeAgentSkills(items, fileGroups, current)
}

func syncMissingDefaultAgentSkills() error {
	packages, err := readDefaultAgentSkillPackages()
	if err != nil {
		return err
	}
	existing, err := repository.ListSystemAgentSkills()
	if err != nil {
		return err
	}
	present := make(map[string]struct{}, len(existing))
	for _, item := range existing {
		present[item.ID] = struct{}{}
	}
	baselined, err := repository.DefaultAgentSkillBaselineRecorded()
	if err != nil {
		return err
	}
	if !baselined {
		if err := baselineMissingLegacyDefaultAgentSkills(packages, present); err != nil {
			return err
		}
	}
	dismissed, err := repository.DismissedDefaultAgentSkillIDs()
	if err != nil {
		return err
	}
	current := now()
	missing := map[string]struct{}{}
	for _, item := range missingDefaultAgentSkillPackages(packages, present, dismissed) {
		missing[item.Root] = struct{}{}
	}
	for index, item := range packages {
		if _, ok := missing[item.Root]; !ok {
			continue
		}
		skill, files, err := newDefaultAgentSkill(item, index, current)
		if err != nil {
			return err
		}
		if _, err := repository.InsertAgentSkillIfAbsent(skill, files); err != nil {
			return err
		}
	}
	return nil
}

func newDefaultAgentSkill(item defaultAgentSkillPackage, sort int, current string) (model.AgentSkill, []model.AgentSkillFile, error) {
	id := defaultAgentSkillID(item.Root)
	files, err := normalizeAgentSkillFiles(id, item.Files, current)
	if err != nil {
		return model.AgentSkill{}, nil, err
	}
	return model.AgentSkill{
		ID: id, Source: model.AgentSkillSourceSystem, Name: item.Name, Description: item.Description,
		Content: item.Content, Enabled: true, Sort: sort, CreatedAt: current, UpdatedAt: current,
	}, files, nil
}

func baselineMissingLegacyDefaultAgentSkills(packages []defaultAgentSkillPackage, present map[string]struct{}) error {
	ids := make([]string, 0)
	for _, item := range packages {
		if item.Root == newlyAddedDefaultAgentSkillRoot {
			continue
		}
		id := defaultAgentSkillID(item.Root)
		if _, ok := present[id]; ok {
			continue
		}
		ids = append(ids, id)
	}
	return repository.RecordDefaultAgentSkillBaseline(ids, now())
}

func missingDefaultAgentSkillPackages(packages []defaultAgentSkillPackage, present map[string]struct{}, dismissed map[string]struct{}) []defaultAgentSkillPackage {
	missing := make([]defaultAgentSkillPackage, 0)
	for _, item := range packages {
		id := defaultAgentSkillID(item.Root)
		if _, ok := present[id]; ok {
			continue
		}
		if _, ok := dismissed[id]; ok {
			continue
		}
		missing = append(missing, item)
	}
	return missing
}

func readDefaultAgentSkillPackages() ([]defaultAgentSkillPackage, error) {
	var entries []string
	var roots []string
	err := fs.WalkDir(defaultAgentSkillFS, "skills", func(filePath string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		entries = append(entries, filePath)
		if !entry.IsDir() {
			if path.Dir(filePath) == "skills" && strings.EqualFold(path.Ext(filePath), ".md") {
				roots = append(roots, filePath)
			} else if strings.EqualFold(path.Base(filePath), "SKILL.md") {
				roots = append(roots, path.Dir(filePath))
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(roots)
	packages := make([]defaultAgentSkillPackage, 0, len(roots))
	for _, root := range roots {
		rootEntry, err := fs.Stat(defaultAgentSkillFS, root)
		if err != nil {
			return nil, err
		}
		skillPath := root
		if rootEntry.IsDir() {
			skillPath = path.Join(root, "SKILL.md")
		}
		data, err := defaultAgentSkillFS.ReadFile(skillPath)
		if err != nil {
			return nil, err
		}
		content := string(data)
		metadata := parseDefaultAgentSkillMetadata(content)
		name := strings.TrimSpace(metadata.Name)
		if name == "" {
			name = path.Base(root)
			if !rootEntry.IsDir() {
				name = strings.TrimSuffix(name, path.Ext(name))
			}
		}
		if strings.TrimSpace(content) == "" || utf8.RuneCountInString(content) > maxAgentSkillContentLength {
			return nil, fmt.Errorf("默认 Skill %s 的 SKILL.md 为空或超过 20000 字", root)
		}
		item := defaultAgentSkillPackage{Root: root, Name: name, Description: strings.TrimSpace(metadata.Description), Content: content}
		if !rootEntry.IsDir() {
			packages = append(packages, item)
			continue
		}
		for _, filePath := range entries {
			if filePath == root || filePath == skillPath || defaultAgentSkillRoot(filePath, roots) != root {
				continue
			}
			entry, err := fs.Stat(defaultAgentSkillFS, filePath)
			if err != nil {
				return nil, err
			}
			relativePath := strings.TrimPrefix(strings.TrimPrefix(filePath, root), "/")
			file := model.AgentSkillFile{Path: relativePath, Kind: model.AgentSkillFileKindFolder, Sort: len(item.Files)}
			if !entry.IsDir() {
				data, err := defaultAgentSkillFS.ReadFile(filePath)
				if err != nil {
					return nil, err
				}
				file.Kind = model.AgentSkillFileKindFile
				file.Content = string(data)
			}
			item.Files = append(item.Files, file)
		}
		packages = append(packages, item)
	}
	return packages, nil
}

func defaultAgentSkillRoot(filePath string, roots []string) string {
	result := ""
	for _, root := range roots {
		if (filePath == root || strings.HasPrefix(filePath, root+"/")) && len(root) > len(result) {
			result = root
		}
	}
	return result
}

func parseDefaultAgentSkillMetadata(content string) defaultAgentSkillMetadata {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return defaultAgentSkillMetadata{}
	}
	rest := strings.TrimPrefix(normalized, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return defaultAgentSkillMetadata{}
	}
	var metadata defaultAgentSkillMetadata
	_ = yaml.Unmarshal([]byte(rest[:end]), &metadata)
	return metadata
}

func defaultAgentSkillID(root string) string {
	sum := sha256.Sum256([]byte(root))
	return fmt.Sprintf("agent-skill-default-%x", sum[:8])
}
