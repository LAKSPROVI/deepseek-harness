# Agent Note: Fork-safe GitHub Actions

Status: implemented

English | [中文](2026-09-09-fork-safe-github-actions.zh.md)

## Problem

The pull-request workflow selects organization-owned larger-runner labels by default. A fork cannot access those runner groups, so its Linux and Windows jobs remain queued instead of producing test evidence. The issue-management and preview workflows also require GitHub App and Cloudflare credentials that only the canonical repository owns.

## Decision

The [pull-request CI workflow](../../../../.github/workflows/ci.yml) selects enterprise or self-hosted runner pools only when `github.repository` is `deepseek-ai/deepseek-harness`. Other repositories use `ubuntu-24.04` for the primary Linux jobs and `windows-2025` for the native Windows jobs. The Linux cache, browser-install, and concurrency branches use the same repository condition, so a fork cannot enter self-hosted behavior by defining a similarly named repository variable.

Resource-heavy fork jobs limit their gate concurrency to one and their internal workers to the smallest valid pools. Fork coverage tests receive a 180-second per-test budget. The canonical repository retains its larger-runner concurrency and timing profiles.

The [issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml), [issue policy](../../../../.github/workflows/issue-policy.yml), and [Cloudflare preview](../../../../.github/workflows/build-preview-cloudflare.yml) jobs run only in the canonical repository. Forks report those organization-owned integrations as skipped without attempting to read unavailable credentials.

[Workflow tests](../../../../scripts/ci-workflow.spec.ts) require every private runner selector to retain the canonical repository condition and public fallback. They also require bounded fork resource limits, the fork coverage timing budget, and canonical-only conditions on credential-dependent jobs.

## Alternatives considered

**Require each fork to reproduce the organization infrastructure.** Rejected because organization runner groups and deployment credentials are not transferable fork prerequisites, and copying credentials would widen access beyond their owner.

**Skip all pull-request automation outside the canonical repository.** Rejected because forks still need build, test, and platform evidence; only private infrastructure and organization-owned integrations are unavailable.

**Infer availability from repository variables or secret values.** Rejected because configuration presence does not grant runner-group access, secret contexts are unsuitable as job-level authorization, and either signal can be copied under the same name in an unrelated repository. Repository identity states the ownership rule directly.

## Consequences

Fork pull requests can execute the same primary CI commands on standard GitHub-hosted runners without oversubscribing their CPUs, while the canonical repository retains its larger-runner defaults and operator-selected failover pools. Bounded fork runs may take longer on the smaller public machines. Organization-owned issue automation and previews appear as explicit skipped jobs in forks rather than failed or indefinitely queued work.
