#!/usr/bin/env ruby
# frozen_string_literal: true

# Apply or strip local frontmatter overrides for synced Pocock skills.
#
# Usage:
#   ruby apply-frontmatter-overrides.rb <skill_name> <skill_md_file> <patches_dir> [--quiet]
#   ruby apply-frontmatter-overrides.rb <skill_name> <skill_md_file> <patches_dir> --strip [--quiet]

require "yaml"

def load_overrides(skill_name, patches_dir)
  config_path = File.join(patches_dir, "local-overrides.yml")
  return {} unless File.exist?(config_path)

  overrides = YAML.safe_load_file(config_path).dig("frontmatter", "preserve", skill_name) || {}
  abort "frontmatter.preserve.#{skill_name} must be an object in #{config_path}" unless overrides.is_a?(Hash)
  overrides
end

def parse_file(path)
  abort "SKILL.md not found: #{path}" unless File.exist?(path)

  content = File.read(path)
  match = content.match(/\A---\n(.*?\n)---\n(.*)\z/m)
  abort "Expected YAML frontmatter in #{path}" unless match

  [content, YAML.safe_load(match[1]) || {}, match[2]]
end

def serialize(meta, body)
  "#{YAML.dump(meta)}---\n#{body}"
end

def apply(skill_name, path, patches_dir)
  overrides = load_overrides(skill_name, patches_dir)
  return false if overrides.empty?

  original, meta, body = parse_file(path)
  meta.merge!(overrides)
  updated = serialize(meta, body)
  return false if updated == original

  File.write(path, updated)
  true
end

def strip(skill_name, path, patches_dir)
  overrides = load_overrides(skill_name, patches_dir)
  return false if overrides.empty?

  original, meta, body = parse_file(path)
  overrides.each_key { |k| meta.delete(k) }
  updated = serialize(meta, body)
  return false if updated == original

  File.write(path, updated)
  true
end

# --- main ---
if ARGV.length < 3
  warn "Usage: apply-frontmatter-overrides.rb <skill_name> <skill_md_file> <patches_dir> [--strip] [--quiet]"
  exit 2
end

skill_name, path, patches_dir, *rest = ARGV
flags = rest.to_set

if (flags - Set["--quiet", "--strip"]).any? || flags.length != rest.length
  warn "Usage: apply-frontmatter-overrides.rb <skill_name> <skill_md_file> <patches_dir> [--strip] [--quiet]"
  exit 2
end

changed = flags.include?("--strip") ? strip(skill_name, path, patches_dir) : apply(skill_name, path, patches_dir)

if changed && !flags.include?("--quiet")
  puts "  #{flags.include?("--strip") ? "STRIPPED" : "OVERRIDE"}: SKILL.md frontmatter"
end
