// The app's icon set. Every screen imports icons from "lucide-react", which Vite aliases to
// this module. On macOS each icon is drawn as the SF Symbol the Mac app uses for it
// (rendered by the system — see src-tauri/src/symbols.rs), so icons match exactly; on
// Windows/Linux, or for a symbol the system lacks, the lucide icon is used.

import * as L from "lucide-real";
import { forwardRef, useEffect, useState, type CSSProperties } from "react";
import { call } from "../lib/backend";

export * from "lucide-real";

/** lucide name → SF Symbol (the Mac app's choice for the same job). */
export const SF_SYMBOLS: Record<string, string> = {
  AlertOctagon: "exclamationmark.octagon", AlertTriangle: "exclamationmark.triangle", AlignLeft: "text.alignleft",
  ArrowDown: "arrow.down", ArrowLeft: "arrow.left", ArrowRight: "arrow.right", ArrowUp: "arrow.up", ArrowUpRight: "arrow.up.right",
  Asterisk: "asterisk", AtSign: "at", Award: "rosette", BadgeCheck: "checkmark.seal", BarChart3: "chart.bar",
  Bird: "bird", Book: "book.closed", BookOpen: "book", BookText: "text.book.closed", Box: "shippingbox", Braces: "curlybraces",
  Brain: "brain", Brush: "paintbrush", Bug: "ladybug", Check: "checkmark", CheckCircle2: "checkmark.circle", CheckSquare: "checkmark.square",
  ChevronDown: "chevron.down", ChevronLeft: "chevron.left", ChevronRight: "chevron.right", ChevronUp: "chevron.up",
  ChevronsDownUp: "rectangle.compress.vertical", ChevronsLeftRight: "arrow.left.and.right", Circle: "circle", CircleCheck: "checkmark.circle",
  CircleDashed: "circle.dashed", CircleDot: "smallcircle.filled.circle", ClipboardList: "list.clipboard", Cloud: "cloud",
  CloudUpload: "icloud.and.arrow.up", Code: "chevron.left.forwardslash.chevron.right", Code2: "chevron.left.forwardslash.chevron.right",
  Command: "command", Compass: "safari", Container: "shippingbox", Cpu: "cpu", Database: "cylinder.split.1x2", Diamond: "diamond",
  DiamondPlus: "plus.diamond", Diff: "plusminus", Ellipsis: "ellipsis", ExternalLink: "arrow.up.right.square", Eye: "eye",
  File: "doc", FileCode: "doc.plaintext", FilePlus: "doc.badge.plus", FileSearch: "doc.text.magnifyingglass", FileText: "doc.text",
  Files: "doc.on.doc", Folder: "folder", FolderCog: "folder.badge.gearshape", FolderOpen: "folder", FolderPlus: "folder.badge.plus",
  GitBranch: "arrow.triangle.branch", GitPullRequest: "arrow.triangle.pull", GitPullRequestArrow: "arrow.triangle.pull", Globe: "globe",
  Hammer: "hammer", Hand: "hand.raised", History: "clock.arrow.circlepath", Hourglass: "hourglass", Image: "photo", Infinity: "infinity",
  Info: "info.circle", KeyRound: "key", Landmark: "building.columns", Layers: "square.3.layers.3d", Lightbulb: "lightbulb", Link: "link",
  ListChecks: "checklist", ListEnd: "text.line.last.and.arrowtriangle.forward", ListFilter: "line.3.horizontal.decrease", Lock: "lock",
  Maximize2: "arrow.up.left.and.arrow.down.right", Minimize2: "arrow.down.right.and.arrow.up.left", Minus: "minus",
  Monitor: "desktopcomputer", MonitorPlay: "play.display", Moon: "moon", MoreHorizontal: "ellipsis.circle", MousePointerClick: "cursorarrow.click",
  Network: "network", OctagonAlert: "exclamationmark.octagon", Package: "shippingbox", PanelLeft: "sidebar.left", PanelRight: "sidebar.right",
  Paperclip: "paperclip", PencilLine: "pencil.line", Play: "play.fill", PlayCircle: "play.circle", Plus: "plus",
  Puzzle: "puzzlepiece.extension", RefreshCcw: "arrow.triangle.2.circlepath", RefreshCw: "arrow.clockwise", RotateCw: "arrow.clockwise",
  ScanSearch: "text.magnifyingglass", Search: "magnifyingglass", Send: "paperplane", Settings: "gearshape", Share: "square.and.arrow.up",
  Share2: "square.and.arrow.up", ShieldCheck: "checkmark.shield", ShieldX: "xmark.shield", Smartphone: "iphone", Sparkle: "sparkle",
  Sparkles: "sparkles", Square: "stop.fill", SquareArrowOutUpRight: "arrow.up.forward.square", SquareCheck: "checkmark.square",
  SquareDashed: "square.dashed", SquareDashedMousePointer: "rectangle.and.hand.point.up.left", SquarePen: "square.and.pencil",
  SquareTerminal: "terminal", SquareUser: "person.crop.square", Sun: "sun.max", SunMoon: "circle.lefthalf.filled", Table: "tablecells",
  Tablet: "ipad", TerminalSquare: "terminal", TextCursor: "character.cursor.ibeam", Trash2: "trash", TrendingUp: "chart.line.uptrend.xyaxis",
  TriangleAlert: "exclamationmark.triangle", Undo2: "arrow.uturn.backward", Upload: "square.and.arrow.up", UserCheck: "person.fill.checkmark",
  UserCircle: "person.crop.circle", UserPlus: "person.badge.plus", Users: "person.2", Wand2: "wand.and.stars",
  Waypoints: "point.3.connected.trianglepath.dotted", Wind: "wind", Workflow: "point.3.filled.connected.trianglepath.dotted", X: "xmark",
  XCircle: "xmark.circle", Zap: "bolt",
};

const useSF = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

type Img = { url: string; w: number; h: number } | null;
const done = new Map<string, Img>();
const pending = new Map<string, Promise<Img>>();

function load(name: string, pt: number, weight: string): Promise<Img> {
  const key = `${name}|${pt}|${weight}`;
  if (done.has(key)) return Promise.resolve(done.get(key)!);
  if (!pending.has(key)) {
    pending.set(key, call<{ png: string; width: number; height: number }>("sf_symbol", { name, size: pt, weight })
      .then((v) => ({ url: `data:image/png;base64,${v.png}`, w: v.width, h: v.height }))
      .catch(() => null)
      .then((img) => { done.set(key, img); return img; }));
  }
  return pending.get(key)!;
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();

/** Draws an SF Symbol by name (on macOS); `fallback` elsewhere. */
export function SFSymbol({ name, size = 13, weight = "regular", className, style, title, fallback = null }:
  { name: string; size?: number; weight?: string; className?: string; style?: CSSProperties; title?: string; fallback?: React.ReactNode }) {
  const key = `${name}|${size}|${weight}`;
  const [img, setImg] = useState<Img | undefined>(done.get(key));
  useEffect(() => {
    if (!useSF) return;
    let live = true;
    load(name, size, weight).then((i) => live && setImg(i));
    return () => { live = false; };
  }, [key]);
  if (!useSF || img === null) return <>{fallback}</>;
  const box = Math.ceil(Math.max(size * 1.2, img?.w ?? 0, img?.h ?? 0));
  return (
    <span aria-hidden={title ? undefined : true} title={title} className={`sf-icon ${className ?? ""}`}
      style={{ display: "inline-block", flex: "none", width: img?.w ?? box, height: img?.h ?? box, verticalAlign: "middle", backgroundColor: "currentColor",
        WebkitMaskImage: img ? `url(${img.url})` : undefined, maskImage: img ? `url(${img.url})` : undefined,
        WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", ...style }} />
  );
}

function make(name: string) {
  const Lucide = (L as any)[name];
  const sf = SF_SYMBOLS[name];
  if (!sf || !useSF || !Lucide) return Lucide;
  const C = forwardRef<HTMLSpanElement, any>((props, ref) => {
    const { size = 24, strokeWidth, className, style, color } = props;
    // lucide sizes are the icon's box; SF point sizes are the glyph's type size.
    const pt = Math.max(8, Math.round(Number(size) * 0.8 * 2) / 2);
    const weight = Number(strokeWidth) >= 2.3 ? "semibold" : "regular";
    const key = `${sf}|${pt}|${weight}`;
    const [img, setImg] = useState<Img | undefined>(done.get(key));
    useEffect(() => {
      let live = true;
      load(sf, pt, weight).then((i) => live && setImg(i));
      return () => { live = false; };
    }, [key]);
    if (img === null) return <Lucide {...props} />;
    const box = Number(size);
    return (
      <span ref={ref} aria-hidden className={`lucide lucide-${kebab(name)} sf-icon ${className ?? ""}`}
        style={{ width: box, height: box, ...style }}>
        {img && <span style={{ width: img.w, height: img.h, flex: "none", backgroundColor: color ?? "currentColor",
          WebkitMaskImage: `url(${img.url})`, maskImage: `url(${img.url})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat" }} />}
      </span>
    );
  });
  C.displayName = name;
  return C as typeof Lucide;
}

export const AlertOctagon = make("AlertOctagon");
export const AlertTriangle = make("AlertTriangle");
export const AlignLeft = make("AlignLeft");
export const ArrowDown = make("ArrowDown");
export const ArrowLeft = make("ArrowLeft");
export const ArrowRight = make("ArrowRight");
export const ArrowUp = make("ArrowUp");
export const ArrowUpRight = make("ArrowUpRight");
export const Asterisk = make("Asterisk");
export const AtSign = make("AtSign");
export const Award = make("Award");
export const BadgeCheck = make("BadgeCheck");
export const BarChart3 = make("BarChart3");
export const Bird = make("Bird");
export const Book = make("Book");
export const BookOpen = make("BookOpen");
export const BookText = make("BookText");
export const Box = make("Box");
export const Braces = make("Braces");
export const Brain = make("Brain");
export const Brush = make("Brush");
export const Bug = make("Bug");
export const Check = make("Check");
export const CheckCircle2 = make("CheckCircle2");
export const CheckSquare = make("CheckSquare");
export const ChevronDown = make("ChevronDown");
export const ChevronLeft = make("ChevronLeft");
export const ChevronRight = make("ChevronRight");
export const ChevronUp = make("ChevronUp");
export const ChevronsDownUp = make("ChevronsDownUp");
export const ChevronsLeftRight = make("ChevronsLeftRight");
export const Circle = make("Circle");
export const CircleCheck = make("CircleCheck");
export const CircleDashed = make("CircleDashed");
export const CircleDot = make("CircleDot");
export const ClipboardList = make("ClipboardList");
export const Cloud = make("Cloud");
export const CloudUpload = make("CloudUpload");
export const Code = make("Code");
export const Code2 = make("Code2");
export const Command = make("Command");
export const Compass = make("Compass");
export const Container = make("Container");
export const Cpu = make("Cpu");
export const Database = make("Database");
export const Diamond = make("Diamond");
export const DiamondPlus = make("DiamondPlus");
export const Diff = make("Diff");
export const Ellipsis = make("Ellipsis");
export const ExternalLink = make("ExternalLink");
export const Eye = make("Eye");
export const File = make("File");
export const FileCode = make("FileCode");
export const FilePlus = make("FilePlus");
export const FileSearch = make("FileSearch");
export const FileText = make("FileText");
export const Files = make("Files");
export const Folder = make("Folder");
export const FolderCog = make("FolderCog");
export const FolderOpen = make("FolderOpen");
export const FolderPlus = make("FolderPlus");
export const GitBranch = make("GitBranch");
export const GitPullRequest = make("GitPullRequest");
export const GitPullRequestArrow = make("GitPullRequestArrow");
export const Globe = make("Globe");
export const Hammer = make("Hammer");
export const Hand = make("Hand");
export const History = make("History");
export const Hourglass = make("Hourglass");
export const Image = make("Image");
export const Infinity = make("Infinity");
export const Info = make("Info");
export const KeyRound = make("KeyRound");
export const Landmark = make("Landmark");
export const Layers = make("Layers");
export const Lightbulb = make("Lightbulb");
export const Link = make("Link");
export const ListChecks = make("ListChecks");
export const ListEnd = make("ListEnd");
export const ListFilter = make("ListFilter");
export const Lock = make("Lock");
export const Maximize2 = make("Maximize2");
export const Minimize2 = make("Minimize2");
export const Minus = make("Minus");
export const Monitor = make("Monitor");
export const MonitorPlay = make("MonitorPlay");
export const Moon = make("Moon");
export const MoreHorizontal = make("MoreHorizontal");
export const MousePointerClick = make("MousePointerClick");
export const Network = make("Network");
export const OctagonAlert = make("OctagonAlert");
export const Package = make("Package");
export const PanelLeft = make("PanelLeft");
export const PanelRight = make("PanelRight");
export const Paperclip = make("Paperclip");
export const PencilLine = make("PencilLine");
export const Play = make("Play");
export const PlayCircle = make("PlayCircle");
export const Plus = make("Plus");
export const Puzzle = make("Puzzle");
export const RefreshCcw = make("RefreshCcw");
export const RefreshCw = make("RefreshCw");
export const RotateCw = make("RotateCw");
export const ScanSearch = make("ScanSearch");
export const Search = make("Search");
export const Send = make("Send");
export const Settings = make("Settings");
export const Share = make("Share");
export const Share2 = make("Share2");
export const ShieldCheck = make("ShieldCheck");
export const ShieldX = make("ShieldX");
export const Smartphone = make("Smartphone");
export const Sparkle = make("Sparkle");
export const Sparkles = make("Sparkles");
export const Square = make("Square");
export const SquareArrowOutUpRight = make("SquareArrowOutUpRight");
export const SquareCheck = make("SquareCheck");
export const SquareDashed = make("SquareDashed");
export const SquareDashedMousePointer = make("SquareDashedMousePointer");
export const SquarePen = make("SquarePen");
export const SquareTerminal = make("SquareTerminal");
export const SquareUser = make("SquareUser");
export const Sun = make("Sun");
export const SunMoon = make("SunMoon");
export const Table = make("Table");
export const Tablet = make("Tablet");
export const TerminalSquare = make("TerminalSquare");
export const TextCursor = make("TextCursor");
export const Trash2 = make("Trash2");
export const TrendingUp = make("TrendingUp");
export const TriangleAlert = make("TriangleAlert");
export const Undo2 = make("Undo2");
export const Upload = make("Upload");
export const UserCheck = make("UserCheck");
export const UserCircle = make("UserCircle");
export const UserPlus = make("UserPlus");
export const Users = make("Users");
export const Wand2 = make("Wand2");
export const Waypoints = make("Waypoints");
export const Wind = make("Wind");
export const Workflow = make("Workflow");
export const X = make("X");
export const XCircle = make("XCircle");
export const Zap = make("Zap");
