/**
 * The 48-tall header (52 on phone). Desktop: title on the left, the indicator
 * chips that must stay visible while their condition holds (sleep disabled,
 * wake-word listening, reload to update), then up to three icon buttons with
 * tooltips. Phone: menu button, title, new-chat button.
 */
import { Menu as MenuIcon, RefreshCw, Search, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../ui/IconButton';

export interface ShellHeaderProps {
  title: string;
  phone: boolean;
  indicators?: ReactNode;
  onOpenDrawer: () => void;
  onNewChat: () => void;
  onSearch: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  /** Work items that need the person; shown as a dot on the phone menu button. */
  attention?: number;
}

export function ShellHeader({ title, phone, indicators, onOpenDrawer, onNewChat, onSearch, onRefresh, refreshing, attention = 0 }: ShellHeaderProps) {
  if (phone) {
    const needs = attention > 0 ? `, ${attention} need${attention === 1 ? 's' : ''} you` : '';
    return (
      <header className="shell-header shell-header--phone">
        <IconButton
          label={`Open navigation${needs}`}
          icon={(
            <span className="shell-nav-item__icon">
              <MenuIcon />
              {attention > 0 && <span className="shell-rail-badge shell-rail-badge--header" aria-hidden="true" />}
            </span>
          )}
          onClick={onOpenDrawer}
          noTooltip
        />
        <h1 className="shell-header__title">{title}</h1>
        {indicators && <div className="shell-header__indicators">{indicators}</div>}
        <IconButton label="New chat" icon={<SquarePen />} onClick={onNewChat} noTooltip />
      </header>
    );
  }
  return (
    <header className="shell-header">
      <h1 className="shell-header__title">{title}</h1>
      <div className="shell-header__end">
        {indicators && <div className="shell-header__indicators">{indicators}</div>}
        <IconButton label="Search" shortcut="Ctrl K" icon={<Search />} onClick={onSearch} />
        <IconButton label="Refresh" icon={<RefreshCw />} onClick={onRefresh} disabled={refreshing} />
      </div>
    </header>
  );
}
