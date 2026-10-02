export type Operation = 'clean' | 'unique' | 'sort' | 'simple' | 'traditional' | 'half' | 'full' | 'replace' | 'trim'|'trimEnd'|'empty'|'paragraphSpace'|'joinParagraph'|'indent'|'layout'|'punctuation'|'vertical'|'upper'|'lower'|'reverse'|'natural'|'removeLetters'|'removeDigits'|'removePunctuation'|'normalize'|'wrap'|'brackets';
export interface TextRequest { operation: Operation; text: string; pattern?: string; replacement?: string; regex?: boolean; ignoreCase?: boolean;width?:number }
export interface DiskNode { path: string; name: string; directory: boolean; size: number; children: DiskNode[]; issue?: string; modified?: number }
export interface ScanResult { root: DiskNode; files: number; directories: number; issues: string[] }
export interface ScanSummary { rootPath: string; files: number; directories: number; bytes: number; issues: string[] }
export interface ScanNode extends Omit<DiskNode, 'children'> { parent: string | null }
export interface ScanProgress { files: number; directories: number; path: string; rootPath: string; bytes: number; nodes: ScanNode[]; issues: number; removed?:string[]; phase?:'scan'|'watch'|'update'|'stopped'; error?:string }
export type Edge = 'top' | 'right' | 'bottom' | 'left';
export type EdgeAction = 'off' | 'volume' | 'brightness';
export interface EdgeSetting { action: EdgeAction; step: number }
export interface DisplayBrightness { name: string; supported: boolean; method: string; brightness?: number; error?: string }
export type CornerAction = 'off' | 'desktop' | 'tasks' | 'lock' | 'one' | 'start' | 'explorer' | 'screenshot' | 'color' | 'hotkey' | 'command';
export interface CornerBinding { shortcut: string; command: string; args: string[]; cwd: string }
export type ToastPosition='top-left'|'top-center'|'top-right'|'bottom-left'|'bottom-center'|'bottom-right';
export interface Appearance { mode: 'system' | 'light' | 'dark'; accent: string; font: import('./fonts').UIFont; density: 'comfortable' | 'compact'; radius: number; lightBackground: string; lightForeground: string; darkBackground: string; darkForeground: string; toastPosition:ToastPosition }
export interface ColorSample { hex: string; rgb: string; hsl: string }
export interface ScreenCapture { url: string; data?:Uint8Array; width: number; height: number; hex: string; pixels: number; x:number; y:number }
export interface Settings {
  diskMonitor:import('./disk-monitor').DiskMonitorSettings;
  preview:import('./preview').PreviewPreferences;
  echo:import('./echo').EchoSettings;
  general: { launchAtLogin: boolean; closeToTray: boolean };
  search:import('./search').SearchSettings;
  utilities:import('./utilities').UtilitySettings;
  keyEcho: boolean; onlyCombinations: boolean; edgeScroll: boolean; copyMenu: boolean; explorerPreview: boolean;
  pauseFullscreen: boolean; excludedApps: string; dwellMs: number; cornerPixels: number; cooldownMs: number;
  copyIntervalMs: number; volumeStep: number; edgePixels: number; corners: Record<'TL' | 'TR' | 'BL' | 'BR', CornerAction>; edges: Record<Edge, EdgeSetting>;
  cornerBindings: Record<'TL' | 'TR' | 'BL' | 'BR', CornerBinding>; appearance: Appearance; colorShortcut: string; colorHistory: string[]; colorFormat: import('./colors').ColorFormat; colorVisibleFormats: import('./colors').ColorFormat[]; colorShowEditor:boolean;
}
export interface MaintenanceRow { name: string; source: string; status: string; command: string; location: string }
export interface FileEntry { name: string; path: string; directory: boolean; size?: number; packedSize?: number }
export interface PreviewData { name: string; path: string; size: number; type: 'text' | 'markdown' | 'html' | 'json' | 'yaml' | 'csv' | 'image' | 'pdf' | 'media' | 'folder' | 'archive' | 'docx' | 'pptx' | 'workbook' | 'epub' | 'font' | 'notebook' | 'unsupported'; workbook?:import('./workbook').WorkbookData; text?: string; textURL?:string; cover?:string; lyrics?:import('./preview').LyricLine[]; url?: string; error?: string; siblings: string[]; navigation?:import('./directory').DirectoryInfo;directory?:import('./directory').DirectoryInfo; entries?: FileEntry[]; metadata?: Record<string,string>; modified?: number; created?: number; truncated?: boolean }
export type { PickerData } from './picker';
export interface OneAPI {
  fileToolsRun(task:import('./file-tools').FileToolTask):Promise<import('./file-tools').FileToolReport>;
  fileToolsCancel(kind?:import('./file-tools').FileToolKind):Promise<void>;
  fileToolsPage(id:string,page:number,group?:number):Promise<import('./file-tools').FileToolRow[]>;
  fileToolsHistory():Promise<import('./file-tools').FileToolReport[]>;
  fileToolsOverview(active?:boolean):Promise<import('./file-tools').FileToolOverview>;
  onFileToolsProgress(callback:(value:import('./file-tools').FileToolProgress)=>void):()=>void;
  systemInformation(kind:import('./system-info').InformationKind,refresh?:boolean):Promise<import('./system-info').InformationReport>;
  onSystemInformationProgress(callback:(value:import('./system-info').InformationProgress)=>void):()=>void;
  onSystemInformationGroup(callback:(value:{kind:import('./system-info').InformationKind;group:import('./system-info').InformationGroup})=>void):()=>void;
  exportSystemInformation(reports:import('./system-info').InformationReport[]):Promise<string|null>;
  diskMonitor(active?:boolean,source?:'maintenance'|'information'):Promise<import('./disk-monitor').DiskMonitorState>;
  diskTrace(enabled:boolean):Promise<import('./disk-monitor').DiskMonitorState>;
  onDiskMonitor(callback:(value:import('./disk-monitor').DiskMonitorState)=>void):()=>void;
  onDiskAlertOpen(callback:()=>void):()=>void;
  onDiskAlert(callback:(value:{drive:string;free:number})=>void):()=>void;
  onMaintenanceProgress(callback:(value:import('./maintenance').MaintenanceProgress)=>void):()=>void;
  previewPreferences(value?:Partial<import('./preview').PreviewPreferences>):Promise<import('./preview').PreviewPreferences>;
  previewOpenWith():Promise<import('./preview').OpenWithApp[]>;previewOpenIn(id:string):Promise<void>;
  maintenanceScan(kind:import('./maintenance').MaintenanceKind):Promise<import('./maintenance').MaintenanceReport>;maintenanceCancel(kind:import('./maintenance').MaintenanceKind):Promise<void>;maintenanceApply(report:string,ids:string[]):Promise<import('./maintenance').MaintenanceOutcome>;maintenanceReceipts():Promise<import('./maintenance').MaintenanceReceipt[]>;maintenanceRestore(id:string):Promise<void>;maintenanceManage(kind:'pagefile'|'hibernate-on'):Promise<void>;
  echoDisplays():Promise<{id:string;name:string;width:number;height:number}[]>;positionEcho():Promise<void>;finishEchoPosition():Promise<void>;onEchoPosition(callback:()=>void):()=>void;
  patchSettings(value: SettingsPatch): Promise<Settings>;
  appInfo(): Promise<{version:string;dataPath:string;packaged:boolean}>;
  fileIcons(paths:string[]):Promise<Record<string,string>>;
  menuPresets():Promise<import('./menu-presets').MenuPreset[]>;
  menuBar():Promise<import('./search').MenuBar>;onMenuBar(callback:(bar:import('./search').MenuBar)=>void):()=>void;onSearchPreferences(callback:(settings:import('./search').SearchSettings)=>void):()=>void;onNavigatePage(callback:(target:import('./menu-builtins').OneMenuTarget)=>void):()=>void;
  menuConfirmationData():Promise<{label:string;message:string;icon:string}>;menuConfirmationAnswer(accepted:boolean):Promise<void>;
  menuOpen(id:string|null,anchor?:{top:number;right:number;focus?:boolean}):Promise<void>;menuBack():Promise<void>;onMenuReset(callback:(items:import('./search').MenuNode[])=>void):()=>void;searchContextMenu(path:string,point:{x:number;y:number},directory?:boolean):Promise<void>;searchSize(rows:number,active?:boolean):Promise<void>;searchMenu():Promise<import('./search').MenuNode[]>;menuChildren(id:string):Promise<import('./search').MenuNode[]>;menuExecute(id:string):Promise<void>;menuSize(size:{width:number;height:number}):Promise<void>;menuFavorite():Promise<import('./search').MenuNode[]>;menuSettings():Promise<void>;onSearchSettings(callback:()=>void):()=>void;
  fileMenuData():Promise<import('./file-menu').FileMenuTarget|null>;onFileMenu(callback:(target:import('./file-menu').FileMenuTarget)=>void):()=>void;fileMenuAction(session:string,action:import('./file-menu').FileMenuAction,value?:string):Promise<void>;fileMenuApps(session:string):Promise<import('./preview').OpenWithApp[]>;fileMenuClose(focus?:boolean,childOnly?:boolean):Promise<void>;fileMenuSubmenu(session:string,top:number,focus?:boolean):Promise<void>;onFileMenuExpanded(callback:(open:boolean)=>void):()=>void;fileMenuSize(session:string,height:number):Promise<void>;onSearchFilesChanged(callback:()=>void):()=>void;
  textPipeline(text:string,steps:import('./text-tools').TextStep[]):Promise<string>;cancelText():Promise<void>;onTextProgress(callback:(value:import('./text-tools').TextProgress)=>void):()=>void;textCompare(left:string,right:string,ignoreWhitespace:boolean):Promise<import('./text-tools').TextComparison>;textDifferencePage(id:string,page:number):Promise<import('./text-tools').TextDifference[]>;clearTextComparison(id:string):Promise<void>;textBatch(request:import('./text-tools').TextBatchRequest):Promise<import('./text-tools').TextBatchResult>;
  searchState():Promise<import('./search').SearchState&{bridgeError:string}>;searchFiles(query:string,foldersOnly?:boolean,token?:string):Promise<import('./search').SearchResult>;rebuildSearch():Promise<void>;cancelSearchIndex():Promise<void>;showSearch():Promise<void>;searchContext():Promise<import('./search').SearchContext>;searchChoose(path:string):Promise<void>;searchReady():Promise<void>;searchPreferences():Promise<import('./search').SearchSettings>;onSearchState(callback:(value:import('./search').SearchState&{bridgeError:string})=>void):()=>void;onSearchContext(callback:(value:import('./search').SearchContext)=>void):()=>void;onSearchReset(callback:()=>void):()=>void;onSearchProgress(callback:(value:import('./search').SearchProgress)=>void):()=>void;
  inspectLocks(path:string):Promise<void>;onLockTarget(callback:(path:string)=>void):()=>void;
  lockState():Promise<import('./locksmith').LocksmithState>;scanLocks(paths:string[]):Promise<import('./locksmith').LocksmithState>;cancelLocks():Promise<void>;endLockProcess(token:string):Promise<void>;onLocks(callback:(value:import('./locksmith').LocksmithState)=>void):()=>void;
  utilityState():Promise<import('./utilities').UtilityState>; topmostWindows():Promise<import('./utilities').WindowEntry[]>; toggleTopmost(id:number):Promise<void>;clearTopmost():Promise<void>;onUtilityState(callback:(value:import('./utilities').UtilityState)=>void):()=>void;
  settings(): Promise<Settings>; saveSettings(value: Settings): Promise<Settings>;
  transform(request: TextRequest): Promise<string>; openText(encoding: string): Promise<{ path: string; text: string } | null>;
  saveText(text: string, encoding: string): Promise<string | null>; copyText(text: string): Promise<void>;
  pickFile(initialPath?: string): Promise<string | null>; droppedFile(file: File): string;
  preview(path: string): Promise<void>; previewData(): Promise<PreviewData>; navigatePreview(step: number): Promise<void>;
  selectPreview(path: string): Promise<void>; directoryOpen(path:string):Promise<import('./directory').DirectoryInfo>;directoryPage(id:string,offset:number,limit:number,query?:string):Promise<import('./directory').DirectoryPage>;directoryRelease(id:string):Promise<void>;
  previewResource(path:string):Promise<string|null>;
  previewFlags(value?: {pinned?:boolean;held?:boolean}): Promise<{pinned:boolean;held:boolean}>;
  appearance(): Promise<Appearance>; installedFonts(refresh?:boolean):Promise<import('./fonts').InstalledFont[]>; onAppearance(callback: (value:Appearance) => void): () => void;
  uiFontSource(family:string):Promise<import('./fonts').UIFontSource|null>;
  pickColor(): Promise<void>; colorCapture(): Promise<ScreenCapture|null>; chooseColor(hex: string): Promise<void>; onColor(callback: (value:string) => void): () => void;
  showColorEditor(hex?:string):Promise<void>;colorState():Promise<import('./colors').ColorState>;onColorSettings(callback:()=>void):()=>void;onColorEditorOpen(callback:(hex:string)=>void):()=>void;colorEditorSize(height:number):Promise<void>;clearColorHistory():Promise<void>;
  onColorSample(callback:(value:ScreenCapture)=>void):()=>void; colorFrame():Promise<void>; recordShortcut(active:boolean):Promise<void>; onPreviewClosing(callback:()=>void):()=>void;
  openFile(path: string): Promise<void>; revealFile(path: string): Promise<void>; startFileDrag(path:string):Promise<void>; searchText(text: string): Promise<void>;
  sendToWorkbench(text: string): Promise<void>; inputStatus(): Promise<{ hook: boolean; native: boolean; error: string }>;
  pickerData(path?: string): Promise<import('./picker').PickerData>; pickerChoose(path: string, overwrite?: boolean): Promise<{ overwrite: boolean }>;
  pickerPlaces(): Promise<import('./picker').PickerPlaces>; pickerOpened(): Promise<import('./picker').PickerOpened>;
  pickerClearRecent(): Promise<void>;
  pickerPreferences(value: import('./picker').PickerPreferences): Promise<import('./picker').PickerPreferences>;
  pickDirectory(initialPath?: string): Promise<string | null>; scan(path: string): Promise<ScanSummary>; cancelScan(): Promise<void>;
  brightnessStatus(): Promise<DisplayBrightness[]>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  windowState(): Promise<{ maximized: boolean; visible: boolean }>;
  onWindowState(callback: (value: { maximized: boolean; visible: boolean }) => void): () => void;
  scanMaintenance(kind: 'startup' | 'registry'): Promise<MaintenanceRow[]>;
  exportMaintenance(rows: MaintenanceRow[]): Promise<string | null>;
  quit(): Promise<void>; closeWindow(): Promise<void>;
  onProgress(callback: (value: ScanProgress) => void): () => void;
  onReceiveText(callback: (value: string) => void): () => void;
  onEcho(callback: (value: string|import('./hud').EchoFrame) => void): () => void;
  onEchoHide(callback:()=>void):()=>void;
  onCopyText(callback: (value: string) => void): () => void;
  onPreviewLoading(callback:()=>void):()=>void;
  onPreviewChanged(callback: () => void): () => void;
}
export type SettingsPatch = { [K in keyof Settings]?: DeepPartial<Settings[K]> };
type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
