<#
.SYNOPSIS
  gantry install (Windows / PowerShell) — lands the gantry skill in supported coding agents.

.DESCRIPTION
  Windows-native counterpart to install.sh. Currently supported:
    - Claude Code      (target: <root>\.claude\skills\gantry)
    - Codex            (target: <root>\.codex\skills\gantry)
    - Generic agents   (target: <root>\.agents\skills\gantry)

  Default behavior: detect installed agents, install at user level. Prefers a
  directory junction (works without admin or developer mode), then a symlink,
  then a plain copy. After a copy install, re-run this script to pick up updates.

.PARAMETER Project
  Install at project level under <path>\.claude\skills, <path>\.codex\skills,
  and <path>\.agents\skills so teammates get gantry when they clone that repo.
  Omit for a user-level install.

.PARAMETER Claude
  Force install for Claude Code.

.PARAMETER Codex
  Force install for Codex.

.PARAMETER Agents
  Force install for generic .agents.

.PARAMETER NoClaude
  Skip Claude Code.

.PARAMETER NoCodex
  Skip Codex.

.PARAMETER NoAgents
  Skip generic .agents.

.EXAMPLE
  .\install.ps1
  Auto-detect agents and install at the user level.

.EXAMPLE
  .\install.ps1 -Project C:\work\myrepo
  Install into a specific project's skill folders.
#>

[CmdletBinding()]
param(
  [string]$Project,
  [switch]$Claude,
  [switch]$Codex,
  [switch]$Agents,
  [switch]$NoClaude,
  [switch]$NoCodex,
  [switch]$NoAgents
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillSrc  = Join-Path $ScriptDir 'skills\gantry'

if (-not (Test-Path -LiteralPath $SkillSrc)) {
  Write-Error "skill source not found at $SkillSrc"
  exit 1
}
$SkillSrc = (Resolve-Path -LiteralPath $SkillSrc).Path

# --- Resolve scope and target roots --------------------------------------
$UserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }

if ($Project) {
  $scope = "project ($Project)"
  $claudeRoots = @((Join-Path $Project '.claude\skills'))
  $codexRoots  = @((Join-Path $Project '.codex\skills'))
  $agentsRoots = @((Join-Path $Project '.agents\skills'))
} else {
  $scope = 'user'
  $claudeRoots = @((Join-Path $UserHome '.claude\skills'))
  $codexRoots  = @((Join-Path $UserHome '.codex\skills'))
  $agentsRoots = @((Join-Path $UserHome '.agents\skills'))
}

# --- Decide which agents to install for ----------------------------------
function Test-Claude {
  (Test-Path -LiteralPath (Join-Path $UserHome '.claude')) -or [bool](Get-Command claude -ErrorAction SilentlyContinue)
}
function Test-Codex {
  (Test-Path -LiteralPath (Join-Path $UserHome '.codex')) -or `
  [bool](Get-Command codex -ErrorAction SilentlyContinue)
}
function Test-Agents {
  Test-Path -LiteralPath (Join-Path $UserHome '.agents')
}

$installClaude = if ($Claude) { $true } elseif ($NoClaude) { $false } else { [bool](Test-Claude) }
$installCodex  = if ($Codex)  { $true } elseif ($NoCodex)  { $false } else { [bool](Test-Codex) }
$installAgents = if ($Agents) { $true } elseif ($NoAgents) { $false } else { [bool](Test-Agents) }

# --- Install helpers ------------------------------------------------------
function Install-To {
  param([string]$TargetRoot, [string]$AgentName)

  $target = Join-Path $TargetRoot 'gantry'
  New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null

  # If a link/junction already points at our source, leave it.
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    if ($item.LinkType -and $item.Target) {
      $existing = @($item.Target)[0]
      try { $existing = (Resolve-Path -LiteralPath $existing -ErrorAction Stop).Path } catch {}
      if ($existing -eq $SkillSrc) {
        Write-Host "  ${AgentName}: already linked $target -> $SkillSrc"
        return
      }
    }
    # Remove whatever is there (stale link or old copy) before reinstalling.
    if ($item.LinkType) {
      # Delete just the reparse point — never recurse into the real source,
      # and use .Delete() so it doesn't prompt under non-interactive shells.
      $item.Delete()
    } else {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }

  # Prefer a junction (no admin / developer mode needed), then a symlink,
  # then a plain copy so future `git pull`s are picked up automatically.
  if (Try-Link -Target $target -Kind 'Junction') {
    Write-Host "  ${AgentName}: linked (junction) $target -> $SkillSrc"
  } elseif (Try-Link -Target $target -Kind 'SymbolicLink') {
    Write-Host "  ${AgentName}: linked (symlink) $target -> $SkillSrc"
  } else {
    Copy-Item -LiteralPath $SkillSrc -Destination $target -Recurse -Force
    Write-Host "  ${AgentName}: copied to $target"
    Write-Host "    (link not permitted; re-run install.ps1 after pulling updates)"
  }
}

function Try-Link {
  param([string]$Target, [string]$Kind)
  try {
    New-Item -ItemType $Kind -Path $Target -Target $SkillSrc -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

# --- Run ------------------------------------------------------------------
Write-Host 'gantry install'
Write-Host "  source: $SkillSrc"
Write-Host "  scope:  $scope"
Write-Host ''

if ($installClaude) {
  foreach ($root in $claudeRoots) { Install-To -TargetRoot $root -AgentName 'Claude Code' }
} else {
  Write-Host '  Claude Code: skipped'
}

if ($installCodex) {
  foreach ($root in $codexRoots) { Install-To -TargetRoot $root -AgentName 'Codex' }
} else {
  Write-Host '  Codex: skipped'
}

if ($installAgents) {
  foreach ($root in $agentsRoots) { Install-To -TargetRoot $root -AgentName 'Generic agents' }
} else {
  Write-Host '  Generic agents: skipped'
}

Write-Host ''
Write-Host 'done.'
