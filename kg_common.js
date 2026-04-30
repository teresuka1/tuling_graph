const fs = require('fs');
const path = require('path');

function normalizeText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/[。！？\n]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function resolvePath(baseDir, targetPath) {
  if (!targetPath) return baseDir;
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function toRegExp(pattern, flags) {
  if (!pattern) return null;
  return new RegExp(pattern, flags || '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(text, keyword) {
  if (!keyword) return 0;
  const matches = String(text).match(new RegExp(escapeRegExp(keyword), 'g'));
  return matches ? matches.length : 0;
}

function unique(values) {
  return Array.from(new Set(values));
}

module.exports = {
  normalizeText,
  splitSentences,
  resolvePath,
  readJson,
  writeJson,
  toRegExp,
  escapeRegExp,
  countOccurrences,
  unique,
};
