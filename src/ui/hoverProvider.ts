// Shows: "lastLoginIp — never accessed by frontend. ~24 bytes/req wasted"
import * as vscode from 'vscode';
import { GreenFieldDiagnosticProvider } from './diagnosticProvider';

export class GreenFieldHoverProvider implements vscode.HoverProvider {
  constructor(private diagnosticProvider: GreenFieldDiagnosticProvider) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const field = this.diagnosticProvider.getAssociatedField(document.uri, position);
    
    if (field) {
      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**🌱 GreenField: Dead Field Detected**\n\n`);
      
      const otherSide = field.side === 'response' ? 'frontend' : 'backend';
      markdown.appendMarkdown(`\`${field.name}\` is included in the ${field.side} payload but never accessed by the ${otherSide}.\n\n`);
      
      const energyEstimate = (field.wasteScore * 1000 * 0.000000006).toExponential(2); // very rough estimate of energy use assuming 1k req/day
      
      markdown.appendMarkdown(`---\n`);
      markdown.appendMarkdown(`**🔋 Sustainability Impact**\n\n`);
      const wasteWithCommas = field.wasteScore.toLocaleString(undefined, { maximumFractionDigits: 2 });
      markdown.appendMarkdown(`* **Waste:** ~${wasteWithCommas} bytes/day\n`);
      markdown.appendMarkdown(`Removing this field saves serialisation overhead and reduces network payload.`);
      
      return new vscode.Hover(markdown);
    }

    return null;
  }
}