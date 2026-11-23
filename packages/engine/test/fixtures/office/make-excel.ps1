$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force $out | Out-Null
function S([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }
$cafeGarbled = 'caf' + (S 0xC3,0xA9)            # cafÃ©
$naive = 'na' + (S 0xEF) + 've'                 # naïve
$nbsp = 'Hello' + (S 0xA0) + 'World'            # NBSP
$quoteGarbled = 'don' + (S 0xE2,0x20AC,0x2122) + 't'  # donâ€™t
$umlautSheet = 'Notes ' + (S 0xFC)              # Notes ü

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }
  $ws = $wb.Worksheets.Item(1)
  $ws.Name = 'Data'
  $ws.Range('A1').Value2 = 'Name'
  $ws.Range('B1').Value2 = 'Amount'
  $ws.Range('C1').Value2 = 'Joined'
  $ws.Range('D1').Value2 = 'Note'
  $ws.Range('A1:D1').Font.Bold = $true
  $ws.Range('A1:D1').Interior.Color = 0xCCE5FF
  $ws.Range('A2').Value2 = $cafeGarbled
  $ws.Range('B2').Value2 = 1234.5
  $ws.Range('B2').NumberFormat = '#,##0.00'
  $ws.Range('C2').Value2 = [double]45366
  $ws.Range('C2').NumberFormat = 'yyyy-mm-dd'
  $ws.Range('D2').Value2 = $naive
  $ws.Range('A3').Value2 = $quoteGarbled
  $ws.Range('B3').Value2 = -42
  $ws.Range('B3').NumberFormat = '#,##0.00'
  $ws.Range('C3').Value2 = 45000
  $ws.Range('C3').NumberFormat = 'yyyy-mm-dd'
  $ws.Range('D3').Value2 = $nbsp
  $ws.Range('A4').Value2 = 'Total'
  $ws.Range('B4').Formula = '=SUM(B2:B3)'
  $ws.Range('B4').NumberFormat = '#,##0.00'
  $ws.Range('D4').Formula = '=A2&"!"'
  # A text cell that looks like a formula (stored as text, never run).
  $ws.Range('A5').NumberFormat = '@'
  $ws.Range('A5').Value2 = '=1+1'
  # Rich text: "Bold " bold, then the garbled word plain.
  $ws.Range('D5').Value2 = 'Bold ' + $cafeGarbled
  $ws.Range('D5').Characters(1, 4).Font.Bold = $true
  # Merged cell
  $ws.Range('A7').Value2 = 'Merged ' + $naive
  $ws.Range('A7:B7').Merge()
  # Hyperlink
  $ws.Hyperlinks.Add($ws.Range('A8'), 'https://example.com/', '', '', 'Visit ' + $cafeGarbled) | Out-Null
  $ws.Columns.Item(1).ColumnWidth = 24

  $ws2 = $wb.Worksheets.Add([Type]::Missing, $ws)
  $ws2.Name = $umlautSheet
  $ws2.Range('A1').Value2 = 'Gr' + (S 0xC3,0xBC) + 'n'   # GrÃ¼n
  $ws2.Range('B1').Value2 = 7

  $wb.SaveAs((Join-Path $out 'formulas.xlsx'), 51)
  $wb.SaveAs((Join-Path $out 'legacy.xls'), 56)
  $wb.SaveAs((Join-Path $out 'legacy.ods'), 60)
  $wb.Close($false)

  # Workbook with a chart and a pivot table.
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }
  $ws = $wb.Worksheets.Item(1)
  $ws.Name = 'Sales'
  $ws.Range('A1').Value2 = 'Region'
  $ws.Range('B1').Value2 = 'Sales'
  $rows = @(@('North', 10), @('South', 20), @('North', 5), @(('Caf' + (S 0xC3,0xA9)), 8))
  for ($i = 0; $i -lt $rows.Count; $i++) {
    $ws.Range("A$($i + 2)").Value2 = [string]$rows[$i][0]
    $ws.Range("B$($i + 2)").Value2 = [double]$rows[$i][1]
  }
  $chart = $ws.ChartObjects().Add(200, 10, 300, 200)
  $chart.Chart.SetSourceData($ws.Range('A1:B5'))
  $pc = $wb.PivotCaches().Create(1, 'Sales!R1C1:R5C2')
  $pt = $pc.CreatePivotTable('Sales!R10C1', 'Pivot1')
  $pt.PivotFields('Region').Orientation = 1
  $pt.AddDataField($pt.PivotFields('Sales')) | Out-Null
  $wb.SaveAs((Join-Path $out 'chart-pivot.xlsx'), 51)
  $wb.Close($false)
} finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
Get-ChildItem $out | Select-Object Name, Length
