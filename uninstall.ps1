# dsh-whale-pet uninstaller - Windows PowerShell 5.1+ (PowerShell 7 also works).
#
#   irm https://raw.githubusercontent.com/OWNER/dsh-whale-pet/main/uninstall.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\dsh-whale-pet\uninstall.ps1"
#
# Uses the same optional environment variables as install.ps1 (set the same ones you used to install):
#   DSH_HOME DSH_PET_PROFILE DSH_PET_HOME DSH_PET_SHORTCUT_DIR
#
# Safe to run more than once: every step says "nothing to do" when there is nothing left to undo.
# Keep this file pure ASCII: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI/GBK.
# No "exit" (it would close the window of someone running this through iex) and no $PSScriptRoot.

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    $Total = 6
    $S = @{ N = 0; Backups = (New-Object System.Collections.ArrayList) }
    $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

    # ------------------------------------------------------------------ helpers
    function Step([string]$Msg) { $S.N++; Write-Host ('[{0}/{1}] {2}' -f $S.N, $Total, $Msg) }
    function Note([string]$Msg) { Write-Host ('      ' + $Msg) }
    function Warn([string]$Msg) { Write-Host ('      WARNING: ' + $Msg) -ForegroundColor Yellow }
    function Get-Opt([string]$Name, [string]$Default) {
        $v = [Environment]::GetEnvironmentVariable($Name)
        if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
        return $v.Trim()
    }
    function Resolve-Abs([string]$P) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($P).TrimEnd('\') }

    function Read-Text([string]$P) {
        $b = [IO.File]::ReadAllBytes($P)
        $bom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
        if ($bom) { $t = [Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3) } else { $t = [Text.Encoding]::UTF8.GetString($b) }
        return (New-Object psobject -Property @{ Text = $t; Bom = $bom })
    }
    function Write-Text([string]$P, [string]$Text, [bool]$Bom) {
        [IO.File]::WriteAllText($P, $Text, (New-Object System.Text.UTF8Encoding -ArgumentList $Bom))
    }
    function Get-Eol([string]$T) { if ($T.Contains("`r`n")) { return "`r`n" } else { return "`n" } }

    function Backup-File([string]$P) {
        $bak = "$P.bak-dsh-whale-pet-$Stamp"
        Copy-Item -LiteralPath $P -Destination $bak -Force
        [void]$S.Backups.Add($bak)
        Note "backup: $bak"
    }

    function Stop-Pet([string]$Dir) {
        $prefix = $Dir.TrimEnd('\') + '\'
        $n = 0
        foreach ($p in @(Get-Process -Name electron -ErrorAction SilentlyContinue)) {
            $path = $null
            try { $path = $p.Path } catch { }
            if ($path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                try { Stop-Process -Id $p.Id -Force; $n++ } catch { }
            }
        }
        if ($n -gt 0) { Start-Sleep -Milliseconds 800 }
        return $n
    }

    $PatchOpts = [Text.RegularExpressions.RegexOptions]::Multiline -bor [Text.RegularExpressions.RegexOptions]::Singleline
    $PatchBlockRe = New-Object Text.RegularExpressions.Regex('^# >>> dsh-whale-pet\b[^\r\n]*\r?\n(?:.*?\r?\n)?# <<< dsh-whale-pet[^\r\n]*(?:\r?\n|\z)', $PatchOpts)
    $PersonaBlockRe = New-Object Text.RegularExpressions.Regex('(?:\r?\n)?<!-- >>> dsh-whale-pet persona -->.*?<!-- <<< dsh-whale-pet persona -->(?:\r?\n)?', [Text.RegularExpressions.RegexOptions]::Singleline)

    # ------------------------------------------------------------------ settings
    $DshHome = Resolve-Abs (Get-Opt 'DSH_HOME' (Join-Path $env:USERPROFILE '.dsh'))
    $ProfileName = Get-Opt 'DSH_PET_PROFILE' 'web'
    $InstallDir = Resolve-Abs (Get-Opt 'DSH_PET_HOME' (Join-Path $env:LOCALAPPDATA 'dsh-whale-pet'))
    $ShortcutDir = Resolve-Abs (Get-Opt 'DSH_PET_SHORTCUT_DIR' ([Environment]::GetFolderPath('Programs')))
    $PatchFile = Join-Path (Join-Path (Join-Path $DshHome 'profiles') $ProfileName) 'cordis.patch.yml'
    $AgentsFile = Join-Path $DshHome 'AGENTS.md'
    $ShortcutPath = Join-Path $ShortcutDir 'DSH Whale Pet.lnk'
    $UserDataDir = Join-Path $env:APPDATA 'dsh-whale-pet'
    $Removed = New-Object System.Collections.ArrayList

    try {
        Write-Host ''
        Write-Host 'dsh-whale-pet uninstaller'

        # ---- 1. stop the pet
        Step 'Stopping the pet'
        $n = Stop-Pet $InstallDir
        if ($n -gt 0) { Note "stopped $n process(es) running from $InstallDir"; [void]$Removed.Add('stopped the running pet') }
        else { Note 'nothing to do (no pet process running from the install dir)' }

        # ---- 2. plugin block in cordis.patch.yml
        Step "Removing the dsh-pet-bridge block from $PatchFile"
        if (-not (Test-Path -LiteralPath $PatchFile)) {
            Note 'nothing to do (file does not exist)'
        } else {
            $r = Read-Text $PatchFile
            $m = $PatchBlockRe.Match($r.Text)
            if (-not $m.Success) {
                Note 'nothing to do (no dsh-whale-pet block in the file)'
            } else {
                $eol = Get-Eol $r.Text
                $new = $r.Text.Remove($m.Index, $m.Length)
                $content = @($new -split '\r?\n' | Where-Object { $_.Trim() -ne '' -and -not $_.TrimStart().StartsWith('#') })
                if ($content.Count -eq 0) {
                    # nothing else left: keep the file a valid (empty) YAML list rather than an empty document
                    $tail = ''
                    if ($m.Value.EndsWith("`n")) { $tail = $eol }
                    $new = $new.Insert($m.Index, '[]' + $tail)
                    Note 'no other patch entries remain; the file now holds an empty list ([])'
                }
                Backup-File $PatchFile
                Write-Text $PatchFile $new $r.Bom
                Note 'block removed'
                [void]$Removed.Add("removed the plugin block from $PatchFile")
            }
        }

        # ---- 3. persona block in AGENTS.md
        Step "Removing the persona block from $AgentsFile"
        if (-not (Test-Path -LiteralPath $AgentsFile)) {
            Note 'nothing to do (file does not exist)'
        } else {
            $r = Read-Text $AgentsFile
            $m = $PersonaBlockRe.Match($r.Text)
            if (-not $m.Success) {
                Note 'nothing to do (no dsh-whale-pet persona block in the file)'
            } else {
                # the regex also takes the one blank line install.ps1 put in front of the block and the line break after it
                $new = $r.Text.Remove($m.Index, $m.Length)
                Backup-File $AgentsFile
                Write-Text $AgentsFile $new $r.Bom
                Note 'block removed (the file itself is left in place)'
                [void]$Removed.Add("removed the persona block from $AgentsFile")
            }
        }

        # ---- 4. shortcut
        Step 'Removing the Start Menu shortcut'
        if (-not (Test-Path -LiteralPath $ShortcutPath)) {
            Note "nothing to do ($ShortcutPath does not exist)"
        } else {
            $ws = New-Object -ComObject WScript.Shell
            $lnk = $ws.CreateShortcut($ShortcutPath)
            $target = [string]$lnk.TargetPath
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($lnk)
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ws)
            if ($target.StartsWith($InstallDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $ShortcutPath -Force
                Note "removed $ShortcutPath"
                [void]$Removed.Add("removed shortcut $ShortcutPath")
            } else {
                Warn "$ShortcutPath points to '$target', not into $InstallDir - leaving it alone."
            }
        }

        # ---- 5. install dir
        Step "Deleting the install folder $InstallDir"
        $pkgFile = Join-Path $InstallDir 'package.json'
        if (-not (Test-Path -LiteralPath $InstallDir)) {
            Note 'nothing to do (folder does not exist)'
        } elseif (-not (Test-Path -LiteralPath $pkgFile)) {
            Warn "$InstallDir has no package.json, so it does not look like a dsh-whale-pet install - not deleting it."
        } else {
            $pkgName = ''
            try { $pkgName = [string]((Read-Text $pkgFile).Text | ConvertFrom-Json).name } catch { }
            if ($pkgName -ne 'dsh-whale-pet') {
                Warn "$pkgFile is not the dsh-whale-pet package (name '$pkgName') - not deleting the folder."
            } else {
                Set-Location -LiteralPath ([IO.Path]::GetTempPath())
                [void](Stop-Pet $InstallDir)
                $done = $false
                for ($i = 1; $i -le 4 -and -not $done; $i++) {
                    try {
                        Remove-Item -LiteralPath $InstallDir -Recurse -Force
                        $done = $true
                    } catch {
                        if ($i -eq 4) { throw "could not delete $InstallDir ($($_.Exception.Message)). Close anything using it and re-run." }
                        Start-Sleep -Seconds 2
                    }
                }
                Note "deleted $InstallDir"
                [void]$Removed.Add("deleted $InstallDir")
            }
        }

        # ---- 6. Electron user data
        Step "Deleting the pet's settings folder $UserDataDir"
        if (-not (Test-Path -LiteralPath $UserDataDir)) {
            Note 'nothing to do (folder does not exist)'
        } else {
            Remove-Item -LiteralPath $UserDataDir -Recurse -Force
            Note "deleted $UserDataDir"
            [void]$Removed.Add("deleted $UserDataDir")
        }

        Write-Host ''
        Write-Host 'dsh-whale-pet is uninstalled.' -ForegroundColor Green
        if ($Removed.Count -eq 0) { Write-Host '  nothing was left to remove' }
        foreach ($c in $Removed) { Write-Host "  changed : $c" }
        foreach ($b in $S.Backups) { Write-Host "  backup  : $b" }
        Write-Host '  note    : DSH hot-reloads the web profile patch; restart DSH Desktop if it still seems to load the plugin.'
        Write-Host '  note    : the persona leaves your DSH conversations untouched; a NEW conversation no longer uses it.'
    } catch {
        Write-Host ("[dsh-whale-pet] FAILED: " + $_.Exception.Message) -ForegroundColor Red
        throw
    }
}
