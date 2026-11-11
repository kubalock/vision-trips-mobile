<?php
namespace VisionTrips\Frontend;
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title><?= e($title) ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&amp;display=swap">
<style>body{margin:0;font-family:'Montserrat',system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:20px;background:#F4F4F1;color:#1B1D1F;display:grid;place-items:center;min-height:100vh;padding:24px}main{max-width:460px;background:#fff;border-radius:20px;padding:36px;box-shadow:0 10px 40px rgba(0,0,0,.08)}h1{font-size:24px;line-height:32px;font-weight:700;margin:0 0 10px}p{line-height:20px;color:#4A4F55;margin:0}@media(prefers-color-scheme:dark){body{background:#121415;color:#ECEAE4}main{background:#1B1E20;box-shadow:none}p{color:#B8BCC2}}</style>
</head>
<body><main><h1><?= e($title) ?></h1><p><?= e($message) ?></p></main></body>
</html>
