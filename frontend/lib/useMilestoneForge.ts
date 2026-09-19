"use client";

import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { executeContractWrite, getReadClient, CONTRACT_ADDRESS, type TxLifecycleState } from "./genlayer";

function useContractWrite(functionName: string) {
  const { address } = useAccount();
  const [state, setState] = useState<TxLifecycleState>({ status: "idle" });

  const run = useCallback(
    async (args: unknown[], valueWei?: bigint) => {
      if (!address) throw new Error("Wallet not connected");
      setState({ status: "idle" });
      return executeContractWrite(address, functionName, args, valueWei, setState);
    },
    [address, functionName]
  );

  return { run, state, reset: () => setState({ status: "idle" }) };
}

export function useCreateGrant() {
  return useContractWrite("create_grant");
}

export function useSubmitMilestoneClaim() {
  return useContractWrite("submit_milestone_claim");
}

export function useFileChallenge() {
  return useContractWrite("file_challenge");
}

export function useResolveChallenge() {
  return useContractWrite("resolve_challenge");
}

export function useReleaseMilestone() {
  return useContractWrite("release_milestone");
}

export function useRetryInconclusive() {
  return useContractWrite("retry_inconclusive_milestone");
}

export function useCancelMilestone() {
  return useContractWrite("cancel_milestone");
}

export function useClaimFailedRefund() {
  return useContractWrite("claim_failed_milestone_refund");
}

/** Direct, unauthenticated reads straight from GenLayer StudioNet. */
export async function readGrant(grantId: string) {
  const client = getReadClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_grant", args: [grantId] });
}

export async function readMilestone(milestoneId: string) {
  const client = getReadClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_milestone", args: [milestoneId] });
}

export async function readCriterion(criterionId: string) {
  const client = getReadClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_criterion", args: [criterionId] });
}

export async function readCriterionResult(resultId: string) {
  const client = getReadClient();
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_criterion_result",
    args: [resultId],
  });
}

export async function readChallenge(challengeId: string) {
  const client = getReadClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_challenge", args: [challengeId] });
}

export async function listGrants() {
  const client = getReadClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName: "list_grants", args: [] });
}

export async function listGrantsByGrantee(address: string) {
  const client = getReadClient();
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "list_grants_by_grantee",
    args: [address],
  });
}

export async function listGrantsByFunder(address: string) {
  const client = getReadClient();
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "list_grants_by_funder",
    args: [address],
  });
}

export async function listChallenges() {
  const client = getReadClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName: "list_challenges", args: [] });
}

export async function readProtocolParams() {
  const client = getReadClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName: "get_protocol_params", args: [] });
}
