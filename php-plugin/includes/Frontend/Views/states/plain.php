<?php
namespace VisionTrips\Frontend;
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title><?= e($title) ?></title>
<style>body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#F4F4F1;color:#1B1D1F;display:grid;place-items:center;min-height:100vh;padding:24px}main{max-width:460px;background:#fff;border-radius:20px;padding:36px;box-shadow:0 10px 40px rgba(0,0,0,.08)}h1{font-size:1.5rem;margin:0 0 10px}p{line-height:1.6;color:#4A4F55;margin:0}@media(prefers-color-scheme:dark){body{background:#121415;color:#ECEAE4}main{background:#1B1E20;box-shadow:none}p{color:#B8BCC2}}</style>
</head>
<body><main><h1><?= e($title) ?></h1><p><?= e($message) ?></p></main></body>
</html>
