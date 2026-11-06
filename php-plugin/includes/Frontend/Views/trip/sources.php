<?php
namespace VisionTrips\Frontend;

use VisionTrips\Support\Jobs;
use VisionTrips\Support\Provenance;

/** Admin-only: where each piece of content came from, every request made, and anything the browser pass reports. */
$rows = Provenance::all();
$reqs = Provenance::requests();
?>
<section class="vt-section vt-sources" id="sources" aria-labelledby="sources-h" data-sources>
  <h2 class="vt-h2" id="sources-h">Content sources <span class="vt-sources__tag">visible to WordPress admins only</span></h2>
  <p class="vt-small">Rows marked <strong>deferred</strong> were not cached when the page was built; the browser loads them in sequence and their real rows are appended here as each one lands.</p>
  <table class="vt-sources__table">
    <thead><tr><th>Section</th><th>Source</th><th>Detail</th></tr></thead>
    <tbody data-sources-body>
      <?php foreach ($rows as $r): ?><tr class="<?= $r['ok'] ? 'is-ok' : 'is-missing' ?>"<?= !empty($r['ref']) ? ' data-ref="' . e($r['ref']) . '"' : '' ?>><td><?= e($r['section']) ?></td><td><?= e($r['source']) ?></td><td><?= e($r['detail']) ?><?php if (!empty($r['ref'])): ?><span class="vt-fb"><button type="button" data-fb="good">Good</button><button type="button" data-fb="rewrite">Rewrite…</button><button type="button" data-fb="never">Never</button></span><?php endif; ?></td></tr><?php endforeach; ?>
    </tbody>
  </table>
  <h3 class="vt-h3 vt-sources__h3">Requests and diagnostics</h3>
  <table class="vt-sources__table">
    <thead><tr><th>Call</th><th>Endpoint</th><th>Status</th><th>Time</th></tr></thead>
    <tbody data-requests-body>
      <?php foreach ($reqs as $r): ?><tr class="<?= $r['ok'] ? 'is-ok' : 'is-missing' ?>"><td><?= e($r['method']) ?></td><td><?= e($r['endpoint']) ?></td><td><?= e($r['ok'] ? 'OK ' . $r['status'] : 'FAILED ' . $r['status'] . ($r['error'] !== '' ? ' · ' . $r['error'] : '')) ?></td><td><?= e($r['ms']) ?> ms</td></tr><?php endforeach; ?>
    </tbody>
  </table>
  <p class="vt-small">Airtable calls shown as "served from cache" made no request. Failures are also written to Vision Trips → Tools &amp; logs. Background AI jobs queued: <?= e(Jobs::queueLength()) ?><?= get_transient('vtr_job_lock') ? ' (one running now)' : '' ?> — they run one at a time, after responses, never in front of a page.</p>
</section>
