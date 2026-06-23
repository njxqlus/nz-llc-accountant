declare module "@njxqlus/jean-claude-bun-dam-sdk" {
	export type Asset = {
		id: string;
		metadata: Record<string, unknown>;
	};

	export type DownloadResult = {
		response: Response;
	};

	export type JeanClaudeBunDamClient = {
		createAsset(params: {
			file: Blob;
			filename?: string;
			metadata?: Record<string, unknown>;
			temporary?: boolean;
			ttlSeconds?: number;
		}): Promise<Asset>;
		finalizeAsset(id: string): Promise<Asset>;
		getAssetFile(id: string): Promise<DownloadResult>;
		deleteAsset(id: string): Promise<{ deleted: true; id: string }>;
	};

	export function createClient(): JeanClaudeBunDamClient;
}
