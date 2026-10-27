# dsh-whale-pet installer - Windows PowerShell 5.1+ (PowerShell 7 also works).
#
#   irm https://raw.githubusercontent.com/OWNER/dsh-whale-pet/main/install.ps1 | iex
#
# Optional environment variables (set them in the same window BEFORE running; see README.md):
#   DSH_HOME DSH_PET_PROFILE DSH_PET_HOME DSH_PET_SRC DSH_PET_ZIP_URL DSH_PET_MODEL_BASE
#   DSH_PET_CORE_URL DSH_PET_PERSONA DSH_PET_SKIP_PLUGIN DSH_PET_SHORTCUT_DIR DSH_PET_NO_START
#
# Keep this file pure ASCII: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI/GBK.
# No "exit" (it would close the window of someone running this through iex) and no $PSScriptRoot.

& {
    $Repo = 'OWNER/dsh-whale-pet'   # GitHub owner/name - the only place to edit before publishing

    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

    $Total = 10
    $S = @{ N = 0; Temp = $null; Changes = (New-Object System.Collections.ArrayList); Backups = (New-Object System.Collections.ArrayList) }
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
    function Test-Flag([string]$Name) { return ((Get-Opt $Name '') -eq '1') }
    function Resolve-Abs([string]$P) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($P).TrimEnd('\') }

    function Get-File([string]$Url, [string]$Dest) {
        $err = ''
        for ($i = 1; $i -le 3; $i++) {
            try {
                Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
                return
            } catch {
                $err = $_.Exception.Message
                Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
                if ($i -lt 3) { Start-Sleep -Seconds (2 * $i) }
            }
        }
        throw "download failed: $Url ($err)"
    }

    function Get-Sha256([string]$P) { return (Get-FileHash -LiteralPath $P -Algorithm SHA256).Hash.ToLowerInvariant() }

    # Read a text file as UTF-8 (BOM remembered, not included in .Text)
    function Read-Text([string]$P) {
        $b = [IO.File]::ReadAllBytes($P)
        $bom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
        if ($bom) { $t = [Text.Encoding]::UTF8.GetString($b, 3, $b.Length - 3) } else { $t = [Text.Encoding]::UTF8.GetString($b) }
        return (New-Object psobject -Property @{ Text = $t; Bom = $bom })
    }
    # Write UTF-8 without BOM (keeps a BOM only if the file already had one)
    function Write-Text([string]$P, [string]$Text, [bool]$Bom) {
        [IO.File]::WriteAllText($P, $Text, (New-Object System.Text.UTF8Encoding -ArgumentList $Bom))
    }
    function Get-Eol([string]$T) { if ($T.Contains("`r`n")) { return "`r`n" } else { return "`n" } }
    function Convert-Eol([string]$T, [string]$Eol) { return ($T -replace "`r?`n", $Eol) }

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

    function Find-RepoRoot([string]$Dir) {
        if (Test-Path -LiteralPath (Join-Path $Dir 'package.json')) { return $Dir }
        $subs = @(Get-ChildItem -LiteralPath $Dir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') })
        if ($subs.Count -eq 1) { return $subs[0].FullName }
        return $null
    }

    # ---- cordis.patch.yml managed block
    $PatchOpts = [Text.RegularExpressions.RegexOptions]::Multiline -bor [Text.RegularExpressions.RegexOptions]::Singleline
    $PatchBlockRe = New-Object Text.RegularExpressions.Regex('^# >>> dsh-whale-pet\b[^\r\n]*\r?\n(?:.*?\r?\n)?# <<< dsh-whale-pet[^\r\n]*(?:\r?\n|\z)', $PatchOpts)
    $ForeignIdRe = New-Object Text.RegularExpressions.Regex('(?m)^[ \t]*(?:-[ \t]+)?id:[ \t]*[''"]?dsh-pet-bridge[''"]?[ \t]*(?:#.*)?\r?$')

    function New-PatchBlock([string]$PluginPath) {
        $q = $PluginPath.Replace("'", "''")
        return (@(
            '# >>> dsh-whale-pet (managed by install.ps1; uninstall.ps1 removes this block)',
            '- insert:',
            '    - id: dsh-pet-bridge',
            "      name: '$q'",
            '# <<< dsh-whale-pet'
        ) -join "`n")
    }

    function Install-Patch([string]$File, [string]$PluginPath) {
        $block = New-PatchBlock $PluginPath
        if (-not (Test-Path -LiteralPath $File)) {
            Write-Text $File ($block + "`n") $false
            Note "created $File with the dsh-pet-bridge block"
            [void]$S.Changes.Add("created $File")
            return
        }
        $r = Read-Text $File
        $text = $r.Text
        $eol = Get-Eol $text
        $blockE = Convert-Eol $block $eol
        $m = $PatchBlockRe.Match($text)
        if ($m.Success) { $rest = $text.Remove($m.Index, $m.Length) } else { $rest = $text }
        if ($ForeignIdRe.IsMatch($rest)) {
            Warn "$File already has a dsh-pet-bridge entry outside the managed block - leaving it alone (not adding a duplicate)."
            return
        }
        if ($m.Success) {
            if ((Convert-Eol $m.Value.TrimEnd("`r", "`n") "`n") -ceq $block) {
                Note "already installed in $File"
                return
            }
            $tail = ''
            if ($m.Value.EndsWith("`n")) { $tail = $eol }
            $new = $text.Substring(0, $m.Index) + $blockE + $tail + $text.Substring($m.Index + $m.Length)
            Backup-File $File
            Write-Text $File $new $r.Bom
            Note "updated the dsh-pet-bridge block in $File"
            [void]$S.Changes.Add("updated $File")
            return
        }
        $content = @($text -split '\r?\n' | Where-Object { $_.Trim() -ne '' -and -not $_.TrimStart().StartsWith('#') })
        if ($content.Count -eq 1 -and $content[0].Trim() -eq '[]') {
            $lm = [regex]::Match($text, '(?m)^[ \t]*\[\][ \t]*(?=\r?$)')
            $new = $text.Substring(0, $lm.Index) + $blockE + $text.Substring($lm.Index + $lm.Length)
        } else {
            $sep = ''
            if ($text.Length -gt 0 -and -not $text.EndsWith("`n")) { $sep = $eol }
            $new = $text + $sep + $blockE + $eol
        }
        Backup-File $File
        Write-Text $File $new $r.Bom
        Note "added the dsh-pet-bridge block to $File"
        [void]$S.Changes.Add("modified $File")
    }

    # ---- AGENTS.md persona block
    $PersonaBegin = '<!-- >>> dsh-whale-pet persona -->'
    $PersonaEnd = '<!-- <<< dsh-whale-pet persona -->'
    $PersonaCoreRe = New-Object Text.RegularExpressions.Regex('<!-- >>> dsh-whale-pet persona -->.*?<!-- <<< dsh-whale-pet persona -->', [Text.RegularExpressions.RegexOptions]::Singleline)

    function Install-Persona([string]$File, [string]$PersonaText) {
        $inner = (Convert-Eol $PersonaText "`n").Trim()
        $block = $PersonaBegin + "`n" + $inner + "`n" + $PersonaEnd
        if (-not (Test-Path -LiteralPath $File)) {
            Write-Text $File ($block + "`n") $false
            Note "created $File with the persona block"
            [void]$S.Changes.Add("created $File")
            return
        }
        $r = Read-Text $File
        $text = $r.Text
        $eol = Get-Eol $text
        $blockE = Convert-Eol $block $eol
        $m = $PersonaCoreRe.Match($text)
        if ($m.Success) {
            if ((Convert-Eol $m.Value "`n") -ceq $block) {
                Note "persona already present in $File"
                return
            }
            $new = $text.Substring(0, $m.Index) + $blockE + $text.Substring($m.Index + $m.Length)
            Backup-File $File
            Write-Text $File $new $r.Bom
            Note "updated the persona block in $File"
            [void]$S.Changes.Add("updated $File")
            return
        }
        $sep = ''
        if ($text.Length -gt 0) {
            if (-not $text.EndsWith("`n")) { $sep = $eol + $eol }
            elseif (-not ($text -match '\n\r?\n$')) { $sep = $eol }
        }
        Backup-File $File
        Write-Text $File ($text + $sep + $blockE + $eol) $r.Bom
        Note "added the persona block to $File"
        [void]$S.Changes.Add("modified $File")
    }

    # ------------------------------------------------------------------ settings
    $SkipPlugin = Test-Flag 'DSH_PET_SKIP_PLUGIN'
    $WantPersona = Test-Flag 'DSH_PET_PERSONA'
    $NoStart = Test-Flag 'DSH_PET_NO_START'
    $DshHome = Resolve-Abs (Get-Opt 'DSH_HOME' (Join-Path $env:USERPROFILE '.dsh'))
    $ProfileName = Get-Opt 'DSH_PET_PROFILE' 'web'
    $InstallDir = Resolve-Abs (Get-Opt 'DSH_PET_HOME' (Join-Path $env:LOCALAPPDATA 'dsh-whale-pet'))
    $ModelBase = (Get-Opt 'DSH_PET_MODEL_BASE' 'https://raw.githubusercontent.com/Andersen216/dsh-whale-girl-live2d/f977bef508690e75ba6535cd8f4ce18e7f6ba9b0').TrimEnd('/')
    $CoreUrl = Get-Opt 'DSH_PET_CORE_URL' 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
    $ShortcutDir = Resolve-Abs (Get-Opt 'DSH_PET_SHORTCUT_DIR' ([Environment]::GetFolderPath('Programs')))
    $ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $ProfileName
    $PatchFile = Join-Path $ProfileDir 'cordis.patch.yml'
    $AgentsFile = Join-Path $DshHome 'AGENTS.md'
    $ShortcutPath = Join-Path $ShortcutDir 'DSH Whale Pet.lnk'

    try {
        Write-Host ''
        Write-Host 'dsh-whale-pet installer'

        # ---- 1. preflight
        Step 'Checking prerequisites'
        if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'this installer only supports Windows' }
        $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
        $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $nodeCmd -or -not $npmCmd) {
            throw 'Node.js / npm not found on PATH. Install it with:  winget install OpenJS.NodeJS.LTS   (then open a NEW terminal and re-run)'
        }
        $nodeVer = ''
        try { $nodeVer = ((& $nodeCmd.Source -v) | Select-Object -First 1).Trim() } catch { }
        Note "node $nodeVer, npm at $($npmCmd.Source)"
        try { if ([version]($nodeVer.TrimStart('v')) -lt [version]'22.12.0') { Warn 'Node 22.12 or newer is recommended (the Electron installer needs it); update with: winget upgrade OpenJS.NodeJS.LTS' } } catch { }
        if ($SkipPlugin) {
            Note 'DSH_PET_SKIP_PLUGIN=1: DSH config will not be touched'
        } elseif (-not (Test-Path -LiteralPath $ProfileDir -PathType Container)) {
            throw "DSH not found: $ProfileDir does not exist. Run DSH Desktop once first, or set DSH_HOME / DSH_PET_PROFILE to the right place, or set DSH_PET_SKIP_PLUGIN=1 to install only the pet."
        } else {
            Note "DSH profile: $ProfileDir"
        }

        # ---- 2. source + copy
        Step "Fetching source and installing files to $InstallDir"
        $S.Temp = Join-Path ([IO.Path]::GetTempPath()) ('dsh-whale-pet-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Force -Path $S.Temp | Out-Null
        $srcOpt = Get-Opt 'DSH_PET_SRC' ''
        $zipPath = $null
        $srcDir = $null
        if ($srcOpt -ne '') {
            $srcAbs = Resolve-Abs $srcOpt
            if (Test-Path -LiteralPath $srcAbs -PathType Container) {
                $srcDir = $srcAbs
                Note "using local folder $srcAbs"
            } elseif (Test-Path -LiteralPath $srcAbs -PathType Leaf) {
                $zipPath = $srcAbs
                Note "using local zip $srcAbs"
            } else {
                throw "DSH_PET_SRC not found: $srcAbs"
            }
        } else {
            $zipUrl = Get-Opt 'DSH_PET_ZIP_URL' "https://github.com/$Repo/archive/refs/heads/main.zip"
            $zipPath = Join-Path $S.Temp 'source.zip'
            Note "downloading $zipUrl"
            Get-File $zipUrl $zipPath
        }
        if ($zipPath) {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $srcDir = Join-Path $S.Temp 'src'
            [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $srcDir)
        }
        $srcRoot = Find-RepoRoot $srcDir
        if (-not $srcRoot) { throw "no package.json found in the source ($srcDir) - is this the dsh-whale-pet repo?" }
        $srcPkg = (Read-Text (Join-Path $srcRoot 'package.json')).Text | ConvertFrom-Json
        if ($srcPkg.name -ne 'dsh-whale-pet' -or -not (Test-Path -LiteralPath (Join-Path $srcRoot 'main.js'))) {
            throw "the source at $srcRoot does not look like dsh-whale-pet (package name '$($srcPkg.name)')"
        }
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        if ($srcRoot.TrimEnd('\') -ieq $InstallDir) {
            Note 'source folder is the install folder; nothing to copy'
        } else {
            # overlay copy: keeps node_modules/, assets/live2d/, the Cubism Core and any user sprites from a previous install
            & robocopy.exe $srcRoot $InstallDir /E /XD .git node_modules /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "copying files to $InstallDir failed (robocopy exit code $LASTEXITCODE)" }
            Note 'files copied'
        }
        [void]$S.Changes.Add("installed files in $InstallDir")

        # ---- 3. npm install (Electron)
        Step 'Installing Electron (npm install)'
        $pkg = (Read-Text (Join-Path $InstallDir 'package.json')).Text | ConvertFrom-Json
        $pinned = [string]$pkg.dependencies.electron
        $electronDir = Join-Path $InstallDir 'node_modules\electron'
        $electronExe = Join-Path $electronDir 'dist\electron.exe'
        $have = ''
        if ((Test-Path -LiteralPath $electronExe) -and (Test-Path -LiteralPath (Join-Path $electronDir 'package.json'))) {
            $have = [string]((Read-Text (Join-Path $electronDir 'package.json')).Text | ConvertFrom-Json).version
        }
        if ($have -eq $pinned) {
            Note "Electron $have already installed - skipping"
        } else {
            if ((Stop-Pet $InstallDir) -gt 0) { Note 'stopped the running pet so Electron can be replaced' }
            Note "installing Electron $pinned (the binary is about 100 MB, please wait)..."
            Push-Location -LiteralPath $InstallDir
            try {
                & $npmCmd.Source install --no-audit --no-fund
                if ($LASTEXITCODE -ne 0) {
                    throw "npm install failed (exit code $LASTEXITCODE). If it is a network problem, set npm_config_registry to a reachable registry and re-run."
                }
                # newer Electron versions have no postinstall hook, so fetch the binary explicitly when npm did not
                if (-not (Test-Path -LiteralPath $electronExe)) {
                    Note 'downloading the Electron binary...'
                    & $nodeCmd.Source (Join-Path $electronDir 'install.js')
                    if ($LASTEXITCODE -ne 0) {
                        throw "the Electron binary download failed (exit code $LASTEXITCODE). If github.com is blocked or slow, set ELECTRON_MIRROR (for example https://npmmirror.com/mirrors/electron/) and re-run."
                    }
                }
            } finally {
                Pop-Location
            }
            if (-not (Test-Path -LiteralPath $electronExe)) { throw "Electron install finished but $electronExe is missing" }
            Note "Electron $pinned installed"
        }

        # ---- 4. Live2D Cubism Core
        Step 'Live2D Cubism Core'
        $coreDest = Join-Path $InstallDir 'renderer\vendor\live2dcubismcore.min.js'
        $coreOk = $false
        if (Test-Path -LiteralPath $coreDest) {
            $ci = Get-Item -LiteralPath $coreDest
            $coreOk = ($ci.Length -gt 51200) -and [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($coreDest)).Contains('Live2DCubismCore')
        }
        if ($coreOk) {
            Note 'already present - skipping download'
        } else {
            $coreTmp = Join-Path $S.Temp 'live2dcubismcore.min.js'
            Note "downloading $CoreUrl"
            Get-File $CoreUrl $coreTmp
            $ci = Get-Item -LiteralPath $coreTmp
            if ($ci.Length -le 51200 -or -not [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($coreTmp)).Contains('Live2DCubismCore')) {
                throw "downloaded Cubism Core from $CoreUrl does not look right ($($ci.Length) bytes, no 'Live2DCubismCore' marker)"
            }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $coreDest) | Out-Null
            Move-Item -LiteralPath $coreTmp -Destination $coreDest -Force
            [void]$S.Changes.Add("downloaded $coreDest")
        }
        $ci = Get-Item -LiteralPath $coreDest
        Note ('size {0} bytes, sha256 {1}' -f $ci.Length, (Get-Sha256 $coreDest))
        Note 'Live2D Cubism Core is proprietary (Live2D Proprietary Software License, https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html); it is downloaded from the official URL and not redistributed by this repo.'

        # ---- 5. model files
        Step 'Live2D model files'
        $manifestPath = Join-Path $InstallDir 'assets\model-files.json'
        if (-not (Test-Path -LiteralPath $manifestPath)) { throw "missing $manifestPath" }
        $manifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $modelDir = Join-Path $InstallDir 'assets\live2d'
        $stage = Join-Path $S.Temp 'model'
        New-Item -ItemType Directory -Force -Path $stage | Out-Null
        $staged = New-Object System.Collections.ArrayList
        $files = @($manifest.files)
        $skipped = 0
        $idx = 0
        foreach ($f in $files) {
            $idx++
            $rel = [string]$f.path
            if ([IO.Path]::IsPathRooted($rel) -or $rel -match '(^|[\\/])\.\.([\\/]|$)') { throw "unsafe path in model-files.json: $rel" }
            $dest = Join-Path $modelDir $rel.Replace('/', '\')
            if ((Test-Path -LiteralPath $dest) -and ((Get-Item -LiteralPath $dest).Length -eq [int64]$f.size) -and ((Get-Sha256 $dest) -eq ([string]$f.sha256).ToLowerInvariant())) {
                $skipped++
                continue
            }
            $url = $ModelBase + '/' + ((([string]$f.src) -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/')
            $part = Join-Path $stage ('{0:D4}.part' -f $idx)
            try {
                Get-File $url $part
            } catch {
                throw "model file '$rel' could not be downloaded: $($_.Exception.Message)"
            }
            $got = Get-Sha256 $part
            $len = (Get-Item -LiteralPath $part).Length
            if ($len -ne [int64]$f.size -or $got -ne ([string]$f.sha256).ToLowerInvariant()) {
                throw "model file '$rel' failed verification (size $len, expected $($f.size); sha256 $got, expected $($f.sha256)). Source: $url"
            }
            [void]$staged.Add(@{ Src = $part; Dest = $dest })
            if ($staged.Count % 10 -eq 0) { Note ("downloaded {0} files so far..." -f $staged.Count) }
        }
        foreach ($item in $staged) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $item.Dest) | Out-Null
            Move-Item -LiteralPath $item.Src -Destination $item.Dest -Force
        }
        Note ("{0} model files: {1} already verified, {2} downloaded and verified (sha256)" -f $files.Count, $skipped, $staged.Count)
        if ($staged.Count -gt 0) { [void]$S.Changes.Add("downloaded $($staged.Count) model files into $modelDir") }
        Note 'Model license: CC BY-NC-SA 4.0 (non-commercial, share-alike); see README / THIRD_PARTY_NOTICES.md for credits.'

        # ---- 6. DSH plugin
        if ($SkipPlugin) {
            Step 'DSH plugin: skipped (DSH_PET_SKIP_PLUGIN=1)'
        } else {
            Step "Registering the dsh-pet-bridge plugin in $PatchFile"
            $pluginFile = Join-Path $InstallDir 'dsh-plugin\lib\index.js'
            if (-not (Test-Path -LiteralPath $pluginFile)) { throw "missing $pluginFile" }
            Install-Patch $PatchFile ($pluginFile.Replace('\', '/'))
            Note 'DSH hot-reloads the web profile patch; if the pet does not react to DSH, restart DSH Desktop.'
        }

        # ---- 7. persona
        if ($SkipPlugin) {
            Step 'Persona: skipped (DSH_PET_SKIP_PLUGIN=1)'
        } elseif (-not $WantPersona) {
            Step 'Persona: skipped (set DSH_PET_PERSONA=1 to add it to DSH AGENTS.md)'
        } else {
            Step "Adding the persona to $AgentsFile"
            $personaFile = Join-Path $InstallDir 'persona\persona.md'
            if (-not (Test-Path -LiteralPath $personaFile)) { throw "missing $personaFile" }
            Install-Persona $AgentsFile (Read-Text $personaFile).Text
            Note 'The persona takes effect in a NEW DSH conversation.'
        }

        # ---- 8. hook config
        Step 'Rendering the optional hook config'
        $tplPath = Join-Path $srcRoot 'hook\dsh-hooks.json'
        $hookOut = Join-Path $InstallDir 'hook\dsh-hooks.json'
        if (-not (Test-Path -LiteralPath $tplPath)) { throw "missing $tplPath" }
        $tpl = (Read-Text $tplPath).Text
        if (-not $tpl.Contains('__PET_DIR__')) {
            Warn 'hook template has no __PET_DIR__ placeholder; leaving it as is'
        } else {
            $rendered = $tpl.Replace('__PET_DIR__', $InstallDir.Replace('\', '/'))
            [void]($rendered | ConvertFrom-Json)
            Write-Text $hookOut $rendered $false
            Note "wrote $hookOut (alternative to the plugin; not enabled automatically)"
        }

        # ---- 9. shortcut
        Step "Creating the Start Menu shortcut"
        New-Item -ItemType Directory -Force -Path $ShortcutDir | Out-Null
        $lnkArgs = '"' + $InstallDir + '"'
        $ws = New-Object -ComObject WScript.Shell
        $lnk = $ws.CreateShortcut($ShortcutPath)
        $exists = Test-Path -LiteralPath $ShortcutPath
        if ($exists -and $lnk.TargetPath -ieq $electronExe -and $lnk.Arguments -ceq $lnkArgs -and $lnk.WorkingDirectory -ieq $InstallDir) {
            Note "shortcut already up to date: $ShortcutPath"
        } else {
            if ($exists) { Backup-File $ShortcutPath }
            $lnk.TargetPath = $electronExe
            $lnk.Arguments = $lnkArgs
            $lnk.WorkingDirectory = $InstallDir
            $lnk.Description = 'DSH Whale Pet'
            $lnk.IconLocation = "$electronExe,0"
            $lnk.Save()
            Note "shortcut: $ShortcutPath"
            [void]$S.Changes.Add("shortcut $ShortcutPath")
        }
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($lnk)
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ws)

        # ---- 10. launch + summary
        if ($NoStart) {
            Step 'Launch: skipped (DSH_PET_NO_START=1)'
        } else {
            Step 'Starting the pet'
            [void](Stop-Pet $InstallDir)
            $savedRunAsNode = $env:ELECTRON_RUN_AS_NODE
            Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
            try {
                Start-Process -FilePath $electronExe -ArgumentList $lnkArgs -WorkingDirectory $InstallDir
            } finally {
                if ($null -ne $savedRunAsNode) { $env:ELECTRON_RUN_AS_NODE = $savedRunAsNode }
            }
            $port = Get-Opt 'DSH_PET_PORT' '47824'
            Note "started; it listens on 127.0.0.1:$port (DSH_PET_PORT changes it)"
        }

        Write-Host ''
        Write-Host 'dsh-whale-pet is installed.' -ForegroundColor Green
        Write-Host "  install dir : $InstallDir"
        foreach ($c in $S.Changes) { Write-Host "  changed     : $c" }
        foreach ($b in $S.Backups) { Write-Host "  backup      : $b" }
        Write-Host '  uninstall   : irm https://raw.githubusercontent.com/OWNER/dsh-whale-pet/main/uninstall.ps1 | iex'.Replace('OWNER/dsh-whale-pet', $Repo)
        Write-Host "                or: powershell -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
        Write-Host '                (if you used custom DSH_HOME / DSH_PET_HOME / DSH_PET_PROFILE, set the same variables first)'
    } catch {
        Write-Host ("[dsh-whale-pet] FAILED: " + $_.Exception.Message) -ForegroundColor Red
        throw
    } finally {
        if ($S.Temp -and (Test-Path -LiteralPath $S.Temp)) { Remove-Item -LiteralPath $S.Temp -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
