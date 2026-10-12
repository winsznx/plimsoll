import { describe, expect, it } from "vitest";
import { canChangeRole, canInvite, canManageMembers, canRemove } from "./org-rules";

const owner = { userId: "o1", role: "owner" as const };
const owner2 = { userId: "o2", role: "owner" as const };
const admin = { userId: "a1", role: "admin" as const };
const admin2 = { userId: "a2", role: "admin" as const };
const member = { userId: "m1", role: "member" as const };

describe("who manages members", () => {
  it("lets owners and admins manage, not members or non-members", () => {
    expect(canManageMembers("owner")).toBeNull();
    expect(canManageMembers("admin")).toBeNull();
    expect(canManageMembers("member")).not.toBeNull();
    expect(canManageMembers(null)).not.toBeNull();
  });

  it("lets owners invite admins and members, admins only members", () => {
    expect(canInvite("owner", "admin")).toBeNull();
    expect(canInvite("owner", "member")).toBeNull();
    expect(canInvite("admin", "member")).toBeNull();
    expect(canInvite("admin", "admin")).toMatch(/members only/);
    expect(canInvite("member", "member")).not.toBeNull();
  });
});

describe("removing members", () => {
  it("never removes the last owner, even by themselves", () => {
    expect(canRemove(owner, owner, 1)).toMatch(/last owner/);
  });

  it("lets an owner leave when another owner remains", () => {
    expect(canRemove(owner, owner, 2)).toBeNull();
    expect(canRemove(owner, owner2, 2)).toBeNull();
  });

  it("lets admins remove members but not owners or other admins", () => {
    // #given an org with one owner
    // #then
    expect(canRemove(admin, member, 1)).toBeNull();
    expect(canRemove(admin, owner, 1)).toMatch(/members only/);
    expect(canRemove(admin, owner, 2)).toMatch(/members only/);
    expect(canRemove(admin, admin2, 1)).toMatch(/members only/);
  });

  it("lets members leave but not remove anyone else", () => {
    expect(canRemove(member, member, 1)).toBeNull();
    expect(canRemove(member, admin, 1)).not.toBeNull();
  });
});

describe("changing roles", () => {
  it("is reserved for owners", () => {
    expect(canChangeRole(admin, member, "admin", 1)).toMatch(/Only owners/);
    expect(canChangeRole(member, member, "owner", 1)).toMatch(/Only owners/);
  });

  it("cannot demote the last owner", () => {
    // #when the only owner demotes themselves
    // #then
    expect(canChangeRole(owner, owner, "admin", 1)).toMatch(/last owner/);
    expect(canChangeRole(owner, owner, "admin", 2)).toBeNull();
  });

  it("promotes and demotes other members freely", () => {
    expect(canChangeRole(owner, member, "owner", 1)).toBeNull();
    expect(canChangeRole(owner, admin, "member", 1)).toBeNull();
    expect(canChangeRole(owner, owner2, "member", 2)).toBeNull();
  });

  it("rejects a no-op change", () => {
    expect(canChangeRole(owner, admin, "admin", 1)).toMatch(/Already/);
  });
});
