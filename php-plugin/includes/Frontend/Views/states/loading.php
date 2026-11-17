<?php
namespace VisionTrips\Frontend;
/** Shown when Vision can't be reached and there is no saved copy yet: calm, branded-neutral, retries itself. */
?>
<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Loading your trip…</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#F4F4F1;color:#1B1D1F;display:grid;place-items:center;min-height:100vh;padding:24px}
main{max-width:460px;width:100%;background:#fff;border-radius:20px;padding:36px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
h1{font-size:1.4rem;margin:0 0 8px}p{line-height:1.6;color:#4A4F55;margin:0 0 14px}
.sk{display:grid;gap:12px;margin:22px 0 6px}.sk span{display:block;height:14px;border-radius:7px;background:linear-gradient(90deg,#E4E3DE 25%,#F2F2EE 50%,#E4E3DE 75%);background-size:200% 100%;animation:sh 1.3s linear infinite}
.sk span:first-child{height:120px;border-radius:14px}.sk span:nth-child(2){width:60%}.sk span:nth-child(3){width:85%}
@keyframes sh{from{background-position:200% 0}to{background-position:-200% 0}}
small{color:#7A8088}
@media(prefers-color-scheme:dark){body{background:#121415;color:#ECEAE4}main{background:#1B1E20;box-shadow:none}p{color:#B8BCC2}.sk span{background:linear-gradient(90deg,#2C3135 25%,#363B40 50%,#2C3135 75%);background-size:200% 100%}}
</style>
</head>
<body><main>
<h1>Just getting your trip ready…</h1>
<p>Our booking system is taking a moment. This page will keep trying on its own — there's nothing you need to do.</p>
<div class="sk" aria-hidden="true"><span></span><span></span><span></span></div>
<small id="s">Trying again shortly…</small>
<script>
(function(){var n=0,s=document.getElementById('s');function go(){n++;var wait=Math.min(30,4+n*3);s.textContent='Trying again in '+wait+' seconds (attempt '+n+')…';setTimeout(function(){fetch(location.href,{cache:'no-store',headers:{'X-Vision-Retry':'1'}}).then(function(r){if(r.ok&&r.headers.get('X-Vision-State')!=='loading'){location.reload();}else{go();}}).catch(go);},wait*1000);}go();})();
</script>
</main></body>
</html>
