import { Component, HostListener, OnDestroy, computed, input, signal } from '@angular/core';
import { VtIcon } from './lucide-icon';

export interface GalleryPhoto { url: string; alt?: string }

@Component({
  selector: 'app-photo-gallery',
  imports: [VtIcon],
  template: `
    @if (photos().length) { <div class="vt-photo-grid grid grid-cols-2 gap-1 overflow-hidden rounded-2xl sm:grid-cols-3">@for (photo of visible(); track photo.url; let index = $index) { <button type="button" class="relative min-h-32 overflow-hidden bg-slate-100" [class.col-span-2]="index === 0 && photos().length > 2" (click)="open(index)" [attr.aria-label]="'Open photo ' + (index + 1) + ' of ' + photos().length"><img class="h-full min-h-32 w-full object-cover" [src]="photo.url" [alt]="photo.alt || ''" loading="lazy" />@if (showCaptions() && photo.alt) { <span class="vt-gallery-caption">{{ photo.alt }}</span> }@if (index === visible().length - 1 && photos().length > visible().length) { <span class="absolute inset-0 grid place-items-center bg-black/55 text-lg font-bold text-white">+{{ photos().length - visible().length }}</span> }</button> }</div> }
    @if (active() >= 0) { <div class="vt-photo-lightbox fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="Photo viewer" (click)="close()"><button type="button" class="vt-photo-lightbox__close" aria-label="Close photo viewer" (click)="close()"><vt-icon name="close" [size]="20" /></button>@if (photos().length > 1) { <button type="button" class="vt-photo-lightbox__nav vt-photo-lightbox__nav--previous" aria-label="Previous photo" (click)="previous($event)"><vt-icon name="chevron-left" [size]="26" /></button> }<figure class="max-h-full max-w-6xl" (click)="$event.stopPropagation()"><img class="max-h-[85vh] max-w-full object-contain" [src]="photos()[active()].url" [alt]="photos()[active()].alt || ''" /><figcaption class="mt-3 text-center text-sm text-white/80">{{ photos()[active()].alt || 'Photo' }} · {{ active() + 1 }} of {{ photos().length }}</figcaption></figure>@if (photos().length > 1) { <button type="button" class="vt-photo-lightbox__nav vt-photo-lightbox__nav--next" aria-label="Next photo" (click)="next($event)"><vt-icon name="chevron-right" [size]="26" /></button> }</div> }
  `,
})
export class PhotoGallery implements OnDestroy {
  readonly photos = input.required<GalleryPhoto[]>(); readonly limit = input(6); readonly showCaptions = input(false); readonly active = signal(-1); readonly visible = computed(() => this.photos().slice(0, this.limit()));
  open(index: number): void { this.active.set(index); document.body.style.overflow = 'hidden'; }
  close(): void { this.active.set(-1); document.body.style.overflow = ''; }
  previous(event: Event): void { event.stopPropagation(); this.active.update((index) => (index - 1 + this.photos().length) % this.photos().length); }
  next(event: Event): void { event.stopPropagation(); this.active.update((index) => (index + 1) % this.photos().length); }
  @HostListener('document:keydown.escape') escape(): void { if (this.active() >= 0) this.close(); }
  @HostListener('document:keydown.arrowleft', ['$event']) left(event: Event): void { if (this.active() >= 0) this.previous(event); }
  @HostListener('document:keydown.arrowright', ['$event']) right(event: Event): void { if (this.active() >= 0) this.next(event); }
  ngOnDestroy(): void { if (this.active() >= 0) document.body.style.overflow = ''; }
}
