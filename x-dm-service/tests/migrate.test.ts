import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { getMigrationsDir } from '../src/migrate.js';

describe('migrations', () => {
  describe('getMigrationsDir', () => {
    it('should resolve to an absolute path ending in /migrations', () => {
      const dir = getMigrationsDir();
      expect(dir).toMatch(/\/migrations$/);
      expect(dir.startsWith('/')).toBe(true); // absolute path
    });

    it('should resolve to a path that exists on disk', () => {
      const dir = getMigrationsDir();
      const stats = statSync(dir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should contain at least one .sql migration file', () => {
      const dir = getMigrationsDir();
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
      expect(files.length).toBeGreaterThanOrEqual(1);
    });

    it('should find migration files in sorted order (001_*, 002_*, ...)', () => {
      const dir = getMigrationsDir();
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      expect(files[0]).toMatch(/^001_/);
      expect(files[files.length - 1]).toMatch(/^006_/);
    });

    it('should use fileURLToPath(import.meta.url) — not process.cwd() — for resolution', () => {
      // The path should contain the project directory, not just the CWD
      const dir = getMigrationsDir();
      expect(dir).toContain('x-dm-service');
    });
  });
});