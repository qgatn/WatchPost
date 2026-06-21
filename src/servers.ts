import { invoke } from "@tauri-apps/api/core";

export const ALIAS_MAX_LEN = 15;

export type AuthMethod = "agent" | "key_file";

export interface ServerEntry {
  id: string;
  alias: string;
  host: string;
  port: number;
  user: string;
  auth: AuthMethod;
  key_path?: string | null;
}

export interface NewServer {
  alias: string;
  host: string;
  port: number;
  user: string;
  auth: AuthMethod;
  key_path?: string | null;
}

export interface TestResult {
  ok: boolean;
  message: string;
  hostname?: string | null;
  os?: string | null;
  latency_ms: number;
}

export interface SshSetupInfo {
  has_public_key: boolean;
  public_key_path?: string | null;
  public_key?: string | null;
}

export function listServers(): Promise<ServerEntry[]> {
  return invoke<ServerEntry[]>("list_servers");
}

export function addServer(server: NewServer): Promise<ServerEntry> {
  return invoke<ServerEntry>("add_server", { server });
}

export function removeServer(id: string): Promise<void> {
  return invoke("remove_server", { id });
}

export function testServer(server: NewServer): Promise<TestResult> {
  return invoke<TestResult>("test_server", { server });
}

export interface DiagnoseStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface DiagnoseResult {
  ok: boolean;
  steps: DiagnoseStep[];
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  message: string;
  ts_ms: number;
}

export function diagnoseServer(server: NewServer): Promise<DiagnoseResult> {
  return invoke<DiagnoseResult>("diagnose_server", { server });
}

export function entryToNewServer(entry: ServerEntry): NewServer {
  return {
    alias: entry.alias,
    host: entry.host,
    port: entry.port,
    user: entry.user,
    auth: entry.auth,
    key_path: entry.key_path,
  };
}

export function getSshSetupInfo(): Promise<SshSetupInfo> {
  return invoke<SshSetupInfo>("get_ssh_setup_info");
}

export interface SetupCommands {
  bashKeygen: string;
  bashCopyId: string;
  bashTest: string;
  psKeygen: string;
  psCopyId: string;
  psTest: string;
}

export function buildSetupCommands(host: string, port: number, user: string): SetupCommands {
  const target = `${user}@${host}`;
  const p = `-p ${port}`;
  return {
    bashKeygen: 'ssh-keygen -t ed25519 -C "watchpost"',
    bashCopyId: `ssh-copy-id ${p} ${target}`,
    bashTest: `ssh ${p} ${target}`,
    psKeygen: 'ssh-keygen -t ed25519 -C "watchpost"',
    psCopyId:
      `type $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh ${p} ${target} ` +
      `"mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`,
    psTest: `ssh ${p} ${target}`,
  };
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
