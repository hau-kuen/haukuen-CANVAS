package service

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

// defaultLocalStorageRoot 本地磁盘存储的默认根目录（相对进程工作目录）。
// 生产环境请在设置里把 RootPath 指到数据盘，例如 D:\canvas-storage。
const defaultLocalStorageRoot = "data/storage"

// localStorageRoot 返回本地存储根目录（已清理路径）。
func localStorageRoot(provider model.StorageProvider) string {
	root := strings.TrimSpace(provider.RootPath)
	if root == "" {
		root = defaultLocalStorageRoot
	}
	return filepath.Clean(root)
}

// localObjectFilePath 把与驱动无关的 objectKey 映射成磁盘绝对路径。
// 防御性校验：清理后必须仍落在 root 之内，防止 ../ 逃逸。
func localObjectFilePath(provider model.StorageProvider, objectKey string) (string, error) {
	cleanKey, err := cleanStoragePath(objectKey)
	if err != nil {
		return "", err
	}
	absoluteRoot, err := filepath.Abs(localStorageRoot(provider))
	if err != nil {
		return "", err
	}
	target := filepath.Join(absoluteRoot, filepath.FromSlash(cleanKey))
	relative, err := filepath.Rel(absoluteRoot, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return "", errors.New("本地存储路径越界")
	}
	return target, nil
}

// putLocalObject 写入对象文件（先写临时文件再改名，避免半截文件）。
func putLocalObject(provider model.StorageProvider, objectKey string, data []byte) error {
	target, err := localObjectFilePath(provider, objectKey)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// limitedReadCloser 让 Range 读取时能同时关闭底层文件。
type limitedReadCloser struct {
	io.Reader
	io.Closer
}

// getLocalObjectStream 读取本地对象，支持 HTTP Range（视频拖动进度条要用）。
func getLocalObjectStream(provider model.StorageProvider, objectKey string, size int64, rangeHeader string) (storageObjectStream, error) {
	target, err := localObjectFilePath(provider, objectKey)
	if err != nil {
		return storageObjectStream{}, err
	}
	file, err := os.Open(target)
	if err != nil {
		if os.IsNotExist(err) {
			return storageObjectStream{}, errors.New("本地存储文件不存在")
		}
		return storageObjectStream{}, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return storageObjectStream{}, err
	}
	actual := info.Size()
	if actual <= 0 {
		actual = size
	}
	if byteRange, ok := parseStorageByteRange(rangeHeader, actual); ok {
		if _, err := file.Seek(byteRange.offset, io.SeekStart); err != nil {
			_ = file.Close()
			return storageObjectStream{}, err
		}
		return storageObjectStream{
			Body:          &limitedReadCloser{Reader: io.LimitReader(file, byteRange.length), Closer: file},
			StatusCode:    206,
			ContentLength: byteRange.length,
			ContentRange:  fmt.Sprintf("bytes %d-%d/%d", byteRange.offset, byteRange.offset+byteRange.length-1, actual),
			AcceptRanges:  true,
		}, nil
	}
	return storageObjectStream{Body: file, StatusCode: 200, ContentLength: actual, AcceptRanges: true}, nil
}

// deleteLocalObject 删除对象文件，并向上清理空目录（最多到 root）。
func deleteLocalObject(provider model.StorageProvider, objectKey string) error {
	target, err := localObjectFilePath(provider, objectKey)
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	absoluteRoot, err := filepath.Abs(localStorageRoot(provider))
	if err != nil {
		return nil
	}
	for directory := filepath.Dir(target); directory != absoluteRoot && strings.HasPrefix(directory, absoluteRoot); directory = filepath.Dir(directory) {
		if err := os.Remove(directory); err != nil {
			break
		}
	}
	return nil
}

// measureLocalProvider 统计本地存储已用字节数。
func measureLocalProvider(provider model.StorageProvider) (int64, error) {
	root := localStorageRoot(provider)
	var total int64
	err := filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}
		total += info.Size()
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return total, err
	}
	return total, nil
}

// projectObjectSegment 把画布项目 ID / 标题转成安全的目录名。
// 目录可读性优先：优先「标题-id前缀」，标题里的非法字符被清掉；标题全空时退化为纯 ID。
func projectObjectSegment(projectID string, projectTitle string) string {
	id := strings.TrimSpace(projectID)
	if id == "" {
		return "_no-project"
	}
	title := strings.TrimSpace(projectTitle)
	if title != "" {
		replacer := strings.NewReplacer("\\", "-", "/", "-", ":", "-", "*", "-", "?", "-", "\"", "-", "<", "-", ">", "-", "|", "-")
		title = replacer.Replace(title)
		title = strings.Join(strings.Fields(title), " ")
		title = strings.Trim(title, " .-")
		if runes := []rune(title); len(runes) > 40 {
			title = string(runes[:40])
		}
	}
	shortID := id
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	segment := strings.Trim(strings.Trim(title+"-"+shortID, "-"), " ")
	if segment == "" {
		segment = shortID
	}
	_, err := cleanStoragePath(segment)
	if err != nil || strings.ContainsAny(segment, "/\\") || segment == "." || segment == "" {
		return shortID
	}
	return segment
}

// storageObjectKey 生成与驱动无关的虚拟路径：{prefix}/{user}/{project}/{YYYY-MM}/{id}{ext}
func storageObjectKey(provider model.StorageProvider, userID string, projectID string, projectTitle string, objectID string, ext string, nowTime time.Time) string {
	if strings.TrimSpace(userID) == "" {
		userID = "anonymous"
	}
	segments := []string{provider.PathPrefix, userID, projectObjectSegment(projectID, projectTitle), nowTime.Format("2006-01"), objectID + ext}
	return strings.Trim(path.Join(segments...), "/")
}
