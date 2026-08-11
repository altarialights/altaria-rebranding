param(
  [Parameter(Mandatory = $true)][string]$Baseline,
  [Parameter(Mandatory = $true)][string]$Candidate
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies 'System.Drawing.dll' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Phase3ImageDiff
{
    public static string Compare(string baselinePath, string candidatePath)
    {
        using (var leftSource = new Bitmap(baselinePath))
        using (var rightSource = new Bitmap(candidatePath))
        {
            if (leftSource.Width != rightSource.Width || leftSource.Height != rightSource.Height)
                throw new InvalidOperationException("Image dimensions differ.");

            var bounds = new Rectangle(0, 0, leftSource.Width, leftSource.Height);
            using (var left = leftSource.Clone(bounds, PixelFormat.Format32bppArgb))
            using (var right = rightSource.Clone(bounds, PixelFormat.Format32bppArgb))
            {
                var leftData = left.LockBits(bounds, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var rightData = right.LockBits(bounds, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                try
                {
                    var bytes = Math.Abs(leftData.Stride) * left.Height;
                    var a = new byte[bytes];
                    var b = new byte[bytes];
                    Marshal.Copy(leftData.Scan0, a, 0, bytes);
                    Marshal.Copy(rightData.Scan0, b, 0, bytes);

                    long absolute = 0;
                    long squared = 0;
                    long changedPixels = 0;
                    int maxChannel = 0;
                    for (var y = 0; y < left.Height; y++)
                    {
                        var row = y * Math.Abs(leftData.Stride);
                        for (var x = 0; x < left.Width; x++)
                        {
                            var offset = row + x * 4;
                            var changed = false;
                            for (var channel = 0; channel < 3; channel++)
                            {
                                var delta = Math.Abs(a[offset + channel] - b[offset + channel]);
                                absolute += delta;
                                squared += (long)delta * delta;
                                if (delta > maxChannel) maxChannel = delta;
                                if (delta > 2) changed = true;
                            }
                            if (changed) changedPixels++;
                        }
                    }

                    var pixels = (long)left.Width * left.Height;
                    var channels = pixels * 3.0;
                    var maePercent = absolute / (channels * 255.0) * 100.0;
                    var rmsPercent = Math.Sqrt(squared / channels) / 255.0 * 100.0;
                    var changedPercent = changedPixels / (double)pixels * 100.0;
                    return string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0}|{1}|{2:F8}|{3:F8}|{4:F8}|{5}",
                        left.Width,
                        left.Height,
                        maePercent,
                        rmsPercent,
                        changedPercent,
                        maxChannel
                    );
                }
                finally
                {
                    left.UnlockBits(leftData);
                    right.UnlockBits(rightData);
                }
            }
        }
    }
}
'@

$baselineRoot = (Resolve-Path -LiteralPath $Baseline).Path
$candidateRoot = (Resolve-Path -LiteralPath $Candidate).Path
$rows = foreach ($file in Get-ChildItem -LiteralPath $baselineRoot -Recurse -File -Filter '*.png') {
  $relative = $file.FullName.Substring($baselineRoot.Length).TrimStart('\', '/')
  $candidatePath = Join-Path $candidateRoot $relative
  if (-not (Test-Path -LiteralPath $candidatePath)) {
    throw "Missing candidate image: $relative"
  }

  $parts = [Phase3ImageDiff]::Compare($file.FullName, $candidatePath).Split('|')
  [PSCustomObject]@{
    file = $relative.Replace('\', '/')
    width = [int]$parts[0]
    height = [int]$parts[1]
    maePercent = [double]$parts[2]
    rmsPercent = [double]$parts[3]
    changedPixelsPercent = [double]$parts[4]
    maxChannelDelta = [int]$parts[5]
  }
}

$rows | ConvertTo-Json -Depth 3
