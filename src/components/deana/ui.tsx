import type { SVGProps } from "react";

export type IconName =
  | "upload"
  | "lock"
  | "shield"
  | "folder"
  | "spark"
  | "heart"
  | "leaf"
  | "pill"
  | "book"
  | "search"
  | "filter"
  | "file"
  | "user"
  | "clock"
  | "check"
  | "x"
  | "alert"
  | "refresh"
  | "dna"
  | "chart"
  | "external"
  | "home"
  | "settings"
  | "help"
  | "menu"
  | "plus"
  | "compose"
  | "trash"
  | "send"
  | "stop"
  | "chat"
  | "download"
  | "print"
  | "globe"
  | "code"
  | "target"
  | "activity"
  | "database"
  | "list"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "more";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

function DnaIconPaths() {
  return (
    <g fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" transform="scale(0.2666667)">
      <path d="M73.352 33.287c-1.16 0-2.35-.064-3.563-.193a1.5 1.5 0 0 1 .318-2.984c7.211.774 13.366-.99 17.333-4.956a1.5 1.5 0 1 1 2.121 2.121c-3.93 3.93-9.599 6.012-16.209 6.012Z" />
      <path d="M26.214 90a1.5 1.5 0 0 1-1.061-2.56c5.682-5.683 6.724-15.295 2.858-26.374-3.966-11.372-3.071-21.674 2.456-28.266 4.991-5.954 13.106-8.365 22.838-6.79a1.5 1.5 0 0 1-.479 2.962c-8.652-1.401-15.775.645-20.061 5.755-4.831 5.762-5.531 15.001-1.92 25.35 4.259 12.209 2.958 22.955-3.57 29.483a1.495 1.495 0 0 1-1.061.44Z" />
      <path d="M42.32 64.459c-1.732 0-3.535-.144-5.399-.434a1.5 1.5 0 0 1 .462-2.965c8.575 1.34 15.636-.731 19.881-5.823 4.804-5.764 5.493-14.99 1.892-25.314-4.259-12.21-2.958-22.956 3.57-29.483a1.5 1.5 0 0 1 2.121 2.121c-5.682 5.682-6.724 15.294-2.859 26.374 3.958 11.344 3.076 21.631-2.419 28.224-3.992 4.787-10.002 7.3-17.249 7.3Z" />
      <path d="M1.5 65.286a1.5 1.5 0 0 1-1.061-2.56c5.047-5.047 12.812-7.013 21.865-5.536a1.5 1.5 0 0 1-.483 2.961c-8.073-1.316-14.914.35-19.26 4.696a1.495 1.495 0 0 1-1.061.439Z" />
      <path d="M61.713 51.758c-.384 0-.768-.146-1.061-.439L38.685 29.351a1.5 1.5 0 0 1 2.121-2.121l21.968 21.968a1.5 1.5 0 0 1-1.061 2.56Z" />
      <path d="M50.258 63.213c-.384 0-.768-.146-1.061-.439L27.229 40.806a1.5 1.5 0 1 1 2.121-2.121l21.968 21.968a1.5 1.5 0 0 1-1.06 2.56Z" />
      <path d="M82.111 31.79c-.384 0-.768-.146-1.061-.439L58.646 8.946a1.5 1.5 0 1 1 2.121-2.121L83.171 29.23a1.5 1.5 0 0 1-1.06 2.56Z" />
      <path d="M29.133 84.769c-.384 0-.768-.146-1.061-.439L5.667 61.925a1.5 1.5 0 0 1 2.121-2.121l22.405 22.404a1.5 1.5 0 0 1-1.06 2.561Z" />
    </g>
  );
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {name === "upload" && <><path {...common} d="M12 16V4" /><path {...common} d="m7 9 5-5 5 5" /><path {...common} d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>}
      {name === "lock" && <><rect {...common} x="5" y="10" width="14" height="10" rx="2" /><path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" /></>}
      {name === "shield" && <><path {...common} d="M12 3 5 6v5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6l-7-3Z" /><path {...common} d="m9 12 2 2 4-5" /></>}
      {name === "folder" && <path {...common} d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />}
      {name === "spark" && <path {...common} d="M12 3 14 9l6 3-6 3-2 6-2-6-6-3 6-3 2-6Z" />}
      {name === "heart" && <path {...common} d="M20.5 8.8c0 5-8.5 10.2-8.5 10.2S3.5 13.8 3.5 8.8A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.5 1.8Z" />}
      {name === "leaf" && <><path {...common} d="M20 4C11 4 6 9 6 18c9 0 14-5 14-14Z" /><path {...common} d="M6 18c3-5 7-8 14-14" /></>}
      {name === "pill" && <><path {...common} d="M10 21 3 14a4 4 0 0 1 0-6l5-5a4 4 0 0 1 6 0l7 7a4 4 0 0 1 0 6l-5 5a4 4 0 0 1-6 0Z" /><path {...common} d="m8 8 8 8" /></>}
      {name === "book" && <><path {...common} d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3V5Z" /><path {...common} d="M4 19a3 3 0 0 1 3-3h13" /></>}
      {name === "search" && <><circle {...common} cx="11" cy="11" r="7" /><path {...common} d="m20 20-4-4" /></>}
      {name === "filter" && <><path {...common} d="M4 5h16" /><path {...common} d="M7 12h10" /><path {...common} d="M10 19h4" /></>}
      {name === "file" && <><path {...common} d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path {...common} d="M14 3v6h5" /></>}
      {name === "user" && <><circle {...common} cx="12" cy="8" r="4" /><path {...common} d="M5 21a7 7 0 0 1 14 0" /></>}
      {name === "clock" && <><circle {...common} cx="12" cy="12" r="9" /><path {...common} d="M12 7v5l3 2" /></>}
      {name === "check" && <path {...common} d="m5 13 4 4L19 7" />}
      {name === "x" && <><path {...common} d="M6 6l12 12" /><path {...common} d="M18 6 6 18" /></>}
      {name === "alert" && <><path {...common} d="M12 3 2 20h20L12 3Z" /><path {...common} d="M12 9v5" /><path {...common} d="M12 17h.01" /></>}
      {name === "refresh" && <><path {...common} d="M20 12a8 8 0 1 1-2.3-5.7" /><path {...common} d="M20 4v6h-6" /></>}
      {name === "dna" && <DnaIconPaths />}
      {name === "chart" && <><path {...common} d="M4 20V4" /><path {...common} d="M4 20h16" /><path {...common} d="M8 16v-5" /><path {...common} d="M12 16V8" /><path {...common} d="M16 16v-9" /></>}
      {name === "external" && <><path {...common} d="M14 4h6v6" /><path {...common} d="m10 14 10-10" /><path {...common} d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" /></>}
      {name === "home" && <><path {...common} d="m3 11 9-8 9 8" /><path {...common} d="M5 10v10h14V10" /><path {...common} d="M9 20v-6h6v6" /></>}
      {name === "settings" && <><circle {...common} cx="12" cy="12" r="3" /><path {...common} d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3a8 8 0 0 0-1.7 1L5 6 3 9.4 5 11a7 7 0 0 0 0 2l-2 1.6L5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1Z" /></>}
      {name === "help" && <><circle {...common} cx="12" cy="12" r="9" /><path {...common} d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" /><path {...common} d="M12 17h.01" /></>}
      {name === "menu" && <><path {...common} d="M4 7h16" /><path {...common} d="M4 12h16" /><path {...common} d="M4 17h16" /></>}
      {name === "plus" && <><path {...common} d="M12 5v14" /><path {...common} d="M5 12h14" /></>}
      {name === "compose" && <><path {...common} d="M12 20h9" /><path {...common} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></>}
      {name === "trash" && <><path {...common} d="M4 7h16" /><path {...common} d="M10 11v6" /><path {...common} d="M14 11v6" /><path {...common} d="M6 7l1 14h10l1-14" /><path {...common} d="M9 7V4h6v3" /></>}
      {name === "send" && <><path {...common} d="M22 2 11 13" /><path {...common} d="M22 2 15 22l-4-9-9-4 20-7Z" /></>}
      {name === "stop" && <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />}
      {name === "chat" && <><path {...common} d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path {...common} d="M8 9h8" /><path {...common} d="M8 13h5" /></>}
      {name === "download" && <><path {...common} d="M12 4v12" /><path {...common} d="m7 11 5 5 5-5" /><path {...common} d="M4 20h16" /></>}
      {name === "print" && <><path {...common} d="M7 8V3h10v5" /><rect {...common} x="6" y="14" width="12" height="7" rx="1" /><path {...common} d="M6 18H4V9h16v9h-2" /></>}
      {name === "globe" && <><circle {...common} cx="12" cy="12" r="9" /><path {...common} d="M3 12h18" /><path {...common} d="M12 3c3 3 3 15 0 18" /><path {...common} d="M12 3c-3 3-3 15 0 18" /></>}
      {name === "code" && <><path {...common} d="m8 9-4 3 4 3" /><path {...common} d="m16 9 4 3-4 3" /><path {...common} d="m14 5-4 14" /></>}
      {name === "target" && <><circle {...common} cx="12" cy="12" r="9" /><circle {...common} cx="12" cy="12" r="5" /><circle {...common} cx="12" cy="12" r="1" /></>}
      {name === "activity" && <path {...common} d="M3 12h4l2-7 5 14 3-7h4" />}
      {name === "database" && <><ellipse {...common} cx="12" cy="5" rx="8" ry="3" /><path {...common} d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path {...common} d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>}
      {name === "list" && <><path {...common} d="M8 6h13" /><path {...common} d="M8 12h13" /><path {...common} d="M8 18h13" /><path {...common} d="M3 6h.01" /><path {...common} d="M3 12h.01" /><path {...common} d="M3 18h.01" /></>}
      {name === "chevronDown" && <path {...common} d="m6 9 6 6 6-6" />}
      {name === "chevronLeft" && <path {...common} d="m15 18-6-6 6-6" />}
      {name === "chevronRight" && <path {...common} d="m9 18 6-6-6-6" />}
      {name === "more" && <><circle {...common} cx="5" cy="12" r="1" /><circle {...common} cx="12" cy="12" r="1" /><circle {...common} cx="19" cy="12" r="1" /></>}
    </svg>
  );
}

export function DeanaWordmark({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`dn-wordmark ${compact ? "dn-wordmark--compact" : ""} ${className}`} aria-label="Deana">
      d<span className="dn-wordmark__e">e</span>ana
    </span>
  );
}
