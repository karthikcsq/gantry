<#
.SYNOPSIS
  gantry install (Windows / PowerShell) — lands the gantry skills in supported coding agents.

.DESCRIPTION
  Windows-native counterpart to install.sh. Currently supported:
    - Claude Code      (target: <root>\.claude\skills\gantry and gantry-mode)
    - Codex            (target: <root>\.codex\skills\gantry and gantry-mode)
    - Generic agents   (target: <root>\.agents\skills\gantry and gantry-mode)

  Default behavior: detect installed agents, install at user level. Prefers a
  directory junction (works without admin or developer mode), then a symlink,
  then a plain copy. After a copy install, re-run this script to pick up updates.

.PARAMETER Project
  Install at project level under <path>\.claude\skills, <path>\.codex\skills,
  and <path>\.agents\skills so teammates get gantry when they clone that repo.
  Omit for a user-level install.

.PARAMETER AgentsPath
  Install generic .agents support under this agents directory, e.g. $HOME\.agents
  or C:\path\to\.agents.

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
  [string]$AgentsPath,
  [switch]$Claude,
  [switch]$Codex,
  [switch]$Agents,
  [switch]$NoClaude,
  [switch]$NoCodex,
  [switch]$NoAgents
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillsSrc = Join-Path $ScriptDir 'skills'

# Discover every skill folder under skills/ so newly added skills are picked up
# on the next run without editing this list.
$SkillNames = @(Get-ChildItem -LiteralPath $SkillsSrc -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
if ($SkillNames.Count -eq 0) {
  Write-Error "no skill folders found under $SkillsSrc"
  exit 1
}

# --- Resolve scope and target roots --------------------------------------
$UserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }

if ($Project) {
  $scope = "project ($Project)"
  $claudeRoots = @((Join-Path $Project '.claude\skills'))
  $codexRoots  = @((Join-Path $Project '.codex\skills'))
} else {
  $scope = 'user'
  $claudeRoots = @((Join-Path $UserHome '.claude\skills'))
  $codexRoots  = @((Join-Path $UserHome '.codex\skills'))
}

if ($AgentsPath) {
  $agentsRoots = @((Join-Path $AgentsPath 'skills'))
} elseif ($Project) {
  $agentsRoots = @((Join-Path $Project '.agents\skills'))
} else {
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
$installAgents = if ($Agents -or $AgentsPath) { $true } elseif ($NoAgents) { $false } else { [bool](Test-Agents) }

# --- Install helpers ------------------------------------------------------
function Install-To {
  param([string]$TargetRoot, [string]$AgentName, [string]$SkillName)

  $skillSrc = (Resolve-Path -LiteralPath (Join-Path $SkillsSrc $SkillName)).Path
  $target = Join-Path $TargetRoot $SkillName
  New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null

  # If a link/junction already points at our source, leave it.
  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    if ($item.LinkType -and $item.Target) {
      $existing = @($item.Target)[0]
      try { $existing = (Resolve-Path -LiteralPath $existing -ErrorAction Stop).Path } catch {}
      if ($existing -eq $skillSrc) {
        Write-Host "  ${AgentName} (${SkillName}): already linked $target -> $skillSrc"
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
  if (Try-Link -Target $target -Source $skillSrc -Kind 'Junction') {
    Write-Host "  ${AgentName} (${SkillName}): linked (junction) $target -> $skillSrc"
  } elseif (Try-Link -Target $target -Source $skillSrc -Kind 'SymbolicLink') {
    Write-Host "  ${AgentName} (${SkillName}): linked (symlink) $target -> $skillSrc"
  } else {
    Copy-Item -LiteralPath $skillSrc -Destination $target -Recurse -Force
    Write-Host "  ${AgentName} (${SkillName}): copied to $target"
    Write-Host "    (link not permitted; re-run install.ps1 after pulling updates)"
  }
}

function Try-Link {
  param([string]$Target, [string]$Source, [string]$Kind)
  try {
    New-Item -ItemType $Kind -Path $Target -Target $Source -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

# --- Run ------------------------------------------------------------------
Write-Host 'gantry install'
Write-Host "  source: $SkillsSrc"
Write-Host "  scope:  $scope"
Write-Host ''

if ($installClaude) {
  foreach ($root in $claudeRoots) {
    foreach ($skillName in $SkillNames) { Install-To -TargetRoot $root -AgentName 'Claude Code' -SkillName $skillName }
  }
} else {
  Write-Host '  Claude Code: skipped'
}

if ($installCodex) {
  foreach ($root in $codexRoots) {
    foreach ($skillName in $SkillNames) { Install-To -TargetRoot $root -AgentName 'Codex' -SkillName $skillName }
  }
} else {
  Write-Host '  Codex: skipped'
}

if ($installAgents) {
  foreach ($root in $agentsRoots) {
    foreach ($skillName in $SkillNames) { Install-To -TargetRoot $root -AgentName 'Generic agents' -SkillName $skillName }
  }
} else {
  Write-Host '  Generic agents: skipped'
}

Write-Host ''
Write-Host 'done.'
