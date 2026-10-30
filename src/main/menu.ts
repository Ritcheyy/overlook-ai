import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * The standard menus without View > Reload: ⌘R belongs to the window, which
 * refreshes the inbox on it. A dev build keeps a force reload and the devtools.
 */
export function installMenu(): void {
  const dev = !app.isPackaged
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      ...(dev ? ([{ role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[]) : []),
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  }
  const template: MenuItemConstructorOptions[] = [...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []), { role: 'fileMenu' }, { role: 'editMenu' }, view, { role: 'windowMenu' }]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
