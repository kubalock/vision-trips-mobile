import { Component, computed, input } from '@angular/core';
import { LucideDynamicIcon, type LucideIconData } from '@lucide/angular';
import * as Icons from './lucide-icon-data';

export type VtIconName = keyof typeof ICONS;

const ICONS = {
  'arrow-right': Icons.ArrowRight,
  'badge-check': Icons.BadgeCheck,
  bell: Icons.Bell,
  briefcase: Icons.BriefcaseBusiness,
  calendar: Icons.CalendarPlus,
  check: Icons.Check,
  'chevron-down': Icons.ChevronDown,
  'chevron-left': Icons.ChevronLeft,
  'chevron-right': Icons.ChevronRight,
  'circle-dot': Icons.CircleDot,
  help: Icons.CircleHelp,
  cloud: Icons.Cloud,
  'cloud-rain': Icons.CloudRain,
  compass: Icons.Compass,
  device: Icons.Smartphone,
  download: Icons.Download,
  external: Icons.ExternalLink,
  file: Icons.FileText,
  files: Icons.Files,
  home: Icons.House,
  list: Icons.List,
  loader: Icons.LoaderCircle,
  mail: Icons.Mail,
  'map-pin': Icons.MapPin,
  message: Icons.MessageCircle,
  moon: Icons.Moon,
  phone: Icons.Phone,
  'phone-call': Icons.PhoneCall,
  plane: Icons.PlaneTakeoff,
  'plane-arrival': Icons.PlaneLanding,
  plus: Icons.Plus,
  pound: Icons.PoundSterling,
  refresh: Icons.RefreshCw,
  send: Icons.Send,
  share: Icons.Share2,
  shield: Icons.ShieldCheck,
  snow: Icons.Snowflake,
  star: Icons.Star,
  sun: Icons.Sun,
  alert: Icons.TriangleAlert,
  trash: Icons.Trash2,
  user: Icons.UserRound,
  wallet: Icons.WalletCards,
  close: Icons.X,
} satisfies Record<string, LucideIconData>;

@Component({
  selector: 'vt-icon',
  imports: [LucideDynamicIcon],
  template: `<svg [lucideIcon]="icon()" [attr.width]="size()" [attr.height]="size()" aria-hidden="true"></svg>`,
  styles: `:host { display: inline-flex; flex: 0 0 auto; line-height: 0; vertical-align: middle; } svg { display: block; width: 100%; height: 100%; }`,
})
export class VtIcon {
  readonly name = input.required<VtIconName>();
  readonly size = input<number | string>(20);
  protected readonly icon = computed(() => ICONS[this.name()]);
}
