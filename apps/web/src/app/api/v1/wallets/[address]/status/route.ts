import { route } from "@/server/http";
import { walletStatus } from "@/server/services/wallets";

export const GET = route<{ address: string }>(async ({ params }) => walletStatus(params.address));
