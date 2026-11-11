import { ExternalPages } from './external-pages';

function fakeWindow(): Window & { replaced: string | null } {
  const page = {
    closed: false,
    opener: {} as unknown,
    replaced: null as string | null,
    document: { title: '', body: { style: { cssText: '' }, textContent: '' } },
    location: { replace(url: string) { page.replaced = url; } },
    close() { page.closed = true; },
  };
  return page as unknown as Window & { replaced: string | null };
}

describe('ExternalPages (web)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reserves a tab during the tap and points it at the URL later, cutting the opener link', async () => {
    const placeholder = fakeWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(placeholder);

    const page = new ExternalPages().reserve();
    const opened = await page.open('https://pay.example/checkout');

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(opened).toBe(true);
    expect(placeholder.replaced).toBe('https://pay.example/checkout');
    expect(placeholder.opener).toBeNull();
  });

  it('closes the reserved tab when there is nothing to open', () => {
    const placeholder = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(placeholder);

    new ExternalPages().reserve().cancel();

    expect(placeholder.closed).toBe(true);
  });

  it('reports a blocked page so the caller can offer a link', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    const opened = await new ExternalPages().reserve().open('https://pay.example/checkout');

    expect(opened).toBe(false);
  });
});
