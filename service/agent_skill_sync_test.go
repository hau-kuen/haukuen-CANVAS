package service

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestDefaultAgentSkillUpgradeSync(t *testing.T) {
	const marker = "DEFAULT_AGENT_SKILL_SYNC_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDefaultAgentSkillUpgradeSync$", "-test.timeout=40s", "-test.v")
		cmd.Env = append(os.Environ(), marker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated skill sync: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}

	previous := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = previous })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	packages, err := readDefaultAgentSkillPackages()
	if err != nil {
		t.Fatal(err)
	}
	var kept, removed, street defaultAgentSkillPackage
	for _, item := range packages {
		switch item.Root {
		case "skills/soul-fashion-lookbook.md":
			kept = item
		case "skills/soul-character-portrait.md":
			removed = item
		case newlyAddedDefaultAgentSkillRoot:
			street = item
		}
	}
	if kept.Root == "" || removed.Root == "" || street.Root == "" {
		t.Fatalf("fixture skills missing: kept=%s removed=%s street=%s", kept.Root, removed.Root, street.Root)
	}
	keptID := defaultAgentSkillID(kept.Root)
	removedID := defaultAgentSkillID(removed.Root)
	streetID := defaultAgentSkillID(street.Root)
	custom := "用户改过的时尚大片正文"
	if _, err := repository.SaveAgentSkillPackage(model.AgentSkill{
		ID: keptID, Source: model.AgentSkillSourceSystem, Name: "自定义时尚", Content: custom, Enabled: true, CreatedAt: "t", UpdatedAt: "t",
	}, nil); err != nil {
		t.Fatal(err)
	}
	if err := repository.MarkAgentSkillsInitialized("t"); err != nil {
		t.Fatal(err)
	}

	if err := EnsureDefaultAgentSkills(); err != nil {
		t.Fatal(err)
	}
	assertSkillContent(t, keptID, custom)
	assertSkillAbsent(t, removedID)
	assertSkillPresent(t, streetID, "Soul 2.0 街拍穿搭")
	dismissed, err := repository.DismissedDefaultAgentSkillIDs()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := dismissed[removedID]; !ok {
		t.Fatal("missing legacy skill was not treated as dismissed")
	}
	if _, ok := dismissed[streetID]; ok {
		t.Fatal("new street skill was dismissed during upgrade")
	}

	if err := EnsureDefaultAgentSkills(); err != nil {
		t.Fatal(err)
	}
	if count := countSkill(t, streetID); count != 1 {
		t.Fatalf("street skill count = %d", count)
	}
	assertSkillAbsent(t, removedID)
	assertSkillContent(t, keptID, custom)

	customStreet := "用户改过的街拍正文"
	if _, err := repository.SaveAgentSkillPackage(model.AgentSkill{
		ID: streetID, Source: model.AgentSkillSourceSystem, Name: "Soul 2.0 街拍穿搭", Content: customStreet, Enabled: true, CreatedAt: "t", UpdatedAt: "t",
	}, nil); err != nil {
		t.Fatal(err)
	}
	if err := EnsureDefaultAgentSkills(); err != nil {
		t.Fatal(err)
	}
	assertSkillContent(t, streetID, customStreet)
	if count := countSkill(t, streetID); count != 1 {
		t.Fatalf("custom street skill count = %d", count)
	}

	if err := DeleteSystemAgentSkill(streetID); err != nil {
		t.Fatal(err)
	}
	assertSkillAbsent(t, streetID)
	dismissed, err = repository.DismissedDefaultAgentSkillIDs()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := dismissed[streetID]; !ok {
		t.Fatal("deleted default skill was not dismissed in the same operation")
	}
	if err := EnsureDefaultAgentSkills(); err != nil {
		t.Fatal(err)
	}
	assertSkillAbsent(t, streetID)
}

func assertSkillContent(t *testing.T, id string, content string) {
	t.Helper()
	item, found, err := repository.GetAgentSkill(id)
	if err != nil || !found {
		t.Fatalf("skill %s found=%v err=%v", id, found, err)
	}
	if item.Content != content {
		t.Fatalf("skill %s content = %q", id, item.Content)
	}
}

func assertSkillPresent(t *testing.T, id string, name string) {
	t.Helper()
	item, found, err := repository.GetAgentSkill(id)
	if err != nil || !found {
		t.Fatalf("skill %s found=%v err=%v", id, found, err)
	}
	if item.Name != name || !strings.Contains(item.Content, "edit_image") {
		t.Fatalf("inserted skill = %#v", item.Name)
	}
}

func assertSkillAbsent(t *testing.T, id string) {
	t.Helper()
	_, found, err := repository.GetAgentSkill(id)
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatalf("skill %s should be absent", id)
	}
}

func countSkill(t *testing.T, id string) int {
	t.Helper()
	items, err := repository.ListSystemAgentSkills()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, item := range items {
		if item.ID == id {
			count++
		}
	}
	return count
}
