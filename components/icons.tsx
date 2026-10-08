import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function make(path: React.ReactNode, filled = false) {
  return function Icon({ size = 24, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {path}
      </svg>
    );
  };
}

export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>,
);
export const MenuIcon = make(<path d="M4 7h16M4 12h16M4 17h16" />);
export const BackIcon = make(<path d="M19 12H5m6-7-7 7 7 7" />);
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const PinIcon = make(
  <path d="M15.5 3.5 20.5 8.5l-2.3.8-3.6 3.6.4 4.4-1.6 1.6-3.8-3.8L4.5 20.2 3.8 19.5l5.1-5.1L5.1 10.6 6.7 9l4.4.4 3.6-3.6z" />,
);
export const PinFilledIcon = make(
  <path
    d="M15.5 3.5 20.5 8.5l-2.3.8-3.6 3.6.4 4.4-1.6 1.6-3.8-3.8L4.5 20.2 3.8 19.5l5.1-5.1L5.1 10.6 6.7 9l4.4.4 3.6-3.6z"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinejoin="round"
  />,
  true,
);
export const FolderIcon = make(<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />);
export const FolderPlusIcon = make(
  <>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <path d="M12 11v5m-2.5-2.5h5" />
  </>,
);
export const MoreIcon = make(
  <>
    <circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
  </>,
);
export const ArchiveIcon = make(
  <>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4" />
  </>,
);
export const UnarchiveIcon = make(
  <>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5M12 17v-5m-2.2 2.2L12 12l2.2 2.2" />
  </>,
);
export const TrashIcon = make(<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2m3.5 0-.8 11.5a1.5 1.5 0 0 1-1.5 1.5H8.3a1.5 1.5 0 0 1-1.5-1.5L6 7m4 4v5m4-5v5" />);
export const RestoreIcon = make(<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4" />);
export const CheckboxIcon = make(
  <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>,
);
export const NotesIcon = make(
  <>
    <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
    <path d="M8 8.5h8M8 12h8M8 15.5h5" />
  </>,
);
export const SunIcon = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </>,
);
export const MoonIcon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
export const SystemIcon = make(
  <>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M8.5 20h7M12 16.5V20" />
  </>,
);
export const SortIcon = make(<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />);
export const LogoutIcon = make(<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4m-4 4h10" />);
export const CloudDoneIcon = make(<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 10a4.2 4.2 0 0 1-.5 8.5zm2.5-5 2 2 3.5-3.5" />);
export const CloudSyncIcon = make(<path d="M7 18.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 10a4.2 4.2 0 0 1-.5 8.5zM12 11v4.5m0 0-2-2m2 2 2-2" />);
export const CloudOffIcon = make(<path d="m3 3 18 18M9 5.3A6 6 0 0 1 18 10a4.2 4.2 0 0 1 2.4 7.3M17 18.5H7a4.5 4.5 0 0 1-.6-9" />);
export const EyeIcon = make(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>,
);
export const EditIcon = make(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />);
export const CopyIcon = make(
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>,
);
export const ChevronRightIcon = make(<path d="m9 6 6 6-6 6" />);
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const LinkIcon = make(
  <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3" />,
);
export const RenameIcon = make(<path d="M4 20h4L19 9l-4-4L4 16zM13 20h7" />);

export function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
