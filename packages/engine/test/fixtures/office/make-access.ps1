$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force $out | Out-Null
function S([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }

function Make([string]$file, [string]$provider) {
  if (Test-Path $file) { Remove-Item $file }
  $conn = "Provider=$provider;Data Source=$file"
  $cat = New-Object -ComObject ADOX.Catalog
  $cat.Create($conn) | Out-Null
  $db = $cat.ActiveConnection
  $db.Execute('CREATE TABLE Customers (ID COUNTER PRIMARY KEY, CustomerName TEXT(100), City TEXT(50), Joined DATETIME, Balance CURRENCY, Visits INTEGER, Score DOUBLE, Active YESNO, Notes MEMO, Photo LONGBINARY)') | Out-Null
  $db.Execute('CREATE TABLE [Order Lines] (LineID COUNTER PRIMARY KEY, Product TEXT(100), Qty INTEGER)') | Out-Null
  $rows = @(
    @(('Caf' + (S 0xC3,0xA9) + ' Lumi' + (S 0xC3,0xA8,0x72,0x65)), 'Paris', '#2024-03-15#', '1234.5', '3', '4.25', 'True', ("'don" + (S 0xE2,0x20AC,0x2122) + "t forget'")),
    @(('Zo' + (S 0xEB) + ' M' + (S 0xFC) + 'ller'), (S 0x41C,0x43E,0x441,0x43A,0x432,0x430), '#2023-12-01#', '-42', '0', '0.5', 'False', ("'Hello" + (S 0xA0) + "World'")),
    @('Plain Name', 'Berlin', '#2022-01-31#', '0', '12', '10', 'True', 'NULL')
  )
  foreach ($r in $rows) {
    $sql = "INSERT INTO Customers (CustomerName, City, Joined, Balance, Visits, Score, Active, Notes) VALUES ('" + $r[0] + "', '" + $r[1] + "', " + $r[2] + ", " + $r[3] + ", " + $r[4] + ", " + $r[5] + ", " + $r[6] + ", " + $r[7] + ")"
    $db.Execute($sql) | Out-Null
  }
  $db.Execute("INSERT INTO [Order Lines] (Product, Qty) VALUES ('Cr" + (S 0xC3,0xA8) + "me', 2)") | Out-Null
  $rs = New-Object -ComObject ADODB.Recordset
  $rs.Open('SELECT ID, Photo FROM Customers', $db, 1, 3)
  $photo = $rs.Fields.Item(1)
  $photo.AppendChunk([byte[]](1, 2, 3, 4))
  $rs.Update()
  $rs.Close()
  $db.Close()
}

Make (Join-Path $out 'customers.accdb') 'Microsoft.ACE.OLEDB.12.0'
# Jet 4 format .mdb (Access 2000-2003) via the ACE provider.
Make (Join-Path $out 'customers.mdb') 'Microsoft.ACE.OLEDB.12.0;Jet OLEDB:Engine Type=5'
Get-ChildItem $out | Select-Object Name, Length
