<?php
namespace VisionTrips\Frontend;

/** @var \VisionTrips\Domain\Trip $trip */
$docTitle = 'Letter';
echo partial('documents/_open', get_defined_vars());
$current = null;
foreach ($templates as $t) {
    if ($t['id'] === $selected) {
        $current = $t;
    }
}
$address = [];
if ($trip->lead) {
    $address[] = $trip->lead->name;
}
?>
  <div class="vt-doc__tools">
    <label>Template <select data-letter-select>
      <option value="">Choose a letter…</option>
      <?php foreach ($templates as $t): ?><option value="<?= e($t['id']) ?>"<?= $t['id'] === $selected ? ' selected' : '' ?>><?= e($t['name']) ?></option><?php endforeach; ?>
    </select></label>
    <?php if (!$templates): ?><span>No letter templates are linked to this brand in Vision (Brands &amp; Branches [Templates], type Letter).</span><?php endif; ?>
  </div>
  <div class="vt-letter">
    <p class="vt-letter__addr"><?= e(implode("\n", $address)) ?></p>
    <p class="vt-letter__date"><?= e($today) ?></p>
    <p class="vt-letter__ref">Re: <?= e($trip->name) ?> — <?= e($trip->ref) ?></p>
    <p>Dear <?= e($trip->leadFirstName() ?: 'Sir/Madam') ?>,</p>
    <div class="vt-letter__body" data-letter-body><?php if ($current): ?><?= raw($current['html']) ?><?php else: ?><p><em>Select a template above.</em></p><?php endif; ?></div>
    <p>Yours sincerely,</p>
    <p><strong><?= e($trip->agentName !== '' ? $trip->agentName : $brand->name) ?></strong><br><?= e($brand->name) ?></p>
  </div>
  <script>
    var T=<?= wp_json_encode(array_column($templates, 'html', 'id'), JSON_UNESCAPED_SLASHES) ?>;
    document.querySelector('[data-letter-select]').addEventListener('change',function(){var b=document.querySelector('[data-letter-body]');b.innerHTML=T[this.value]||'<p><em>Select a template above.</em></p>';var u=new URL(location);u.searchParams.set('comm',this.value);history.replaceState(null,'',u);});
  </script>
<?= partial('documents/_close', get_defined_vars()) ?>
