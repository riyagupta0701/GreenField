// Person E — Status Bar
// Shows: ⚡ GreenField: 18 dead fields | ~3.1 KB/req wasted
import * as vscode from 'vscode';

export function createStatusBar(){

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)

  item.text = "⚡ GreenField"

  item.show()

  return item
}