# Agent Note: fork 安全的 GitHub Actions

Status: implemented

[English](2026-09-09-fork-safe-github-actions.md) | 中文

## Problem

拉取请求工作流默认选择组织拥有的大型 runner 标签。fork 无法访问这些 runner group，因此其 Linux 和 Windows 作业会持续排队，无法生成测试证据。Issue 管理和预览工作流还需要仅由规范仓库持有的 GitHub App 与 Cloudflare 凭据。

## Decision

[拉取请求 CI 工作流](../../../../.github/workflows/ci.yml)仅在 `github.repository` 为 `deepseek-ai/deepseek-harness` 时选择企业级或自托管 runner 池。其他仓库为主要 Linux 作业使用 `ubuntu-24.04`，为原生 Windows 作业使用 `windows-2025`。Linux 缓存、浏览器安装和并发分支使用相同的仓库条件，因此 fork 即使定义同名仓库变量，也无法进入自托管行为。

资源密集型 fork 作业将 gate 并发限制为一，并将内部 worker 限制为最小有效池；fork coverage 测试获得每项测试 180 秒的预算。规范仓库保留大型 runner 的并发与时限配置。

[Issue 生命周期](../../../../.github/workflows/issue-lifecycle.yml)、[Issue 策略](../../../../.github/workflows/issue-policy.yml)和 [Cloudflare 预览](../../../../.github/workflows/build-preview-cloudflare.yml)作业仅在规范仓库运行。fork 会将这些组织拥有的集成报告为已跳过，而不会尝试读取不可用的凭据。

[工作流测试](../../../../scripts/ci-workflow.spec.ts)要求每个私有 runner 选择器保留规范仓库条件和公共回退。测试还要求 fork 使用有界资源限制和 coverage 时限预算，并要求依赖凭据的作业带有仅限规范仓库的条件。

## Alternatives considered

**要求每个 fork 复制组织基础设施。** 否决，因为组织 runner group 和部署凭据不能作为可转移的 fork 先决条件，复制凭据还会把访问权限扩大到其所有者之外。

**在规范仓库之外跳过全部拉取请求自动化。** 否决，因为 fork 仍需构建、测试和平台证据；不可用的只有私有基础设施与组织拥有的集成。

**从仓库变量或 secret 值推断可用性。** 否决，因为配置存在并不授予 runner group 访问权限，secret context 不适合作为作业级授权，而且无关仓库可以复制同名信号。仓库身份直接表达所有权规则。

## Consequences

fork 拉取请求可以在标准 GitHub 托管 runner 上执行相同的主要 CI 命令，而不会过度占用其 CPU；规范仓库保留大型 runner 默认值和由运维人员选择的故障切换池。有界 fork 运行在较小的公共机器上可能需要更长时间。组织拥有的 Issue 自动化和预览在 fork 中显示为明确跳过的作业，而不是失败或无限排队的工作。
