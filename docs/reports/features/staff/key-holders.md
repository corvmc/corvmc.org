# Key holders

Status: ✅ /staff/building-access

Who holds standing access to the building. Physical keys and alarm codes are an issue/return log in `access_holding` (who issued it, when, whether it came back; a holder can be a member or a typed name such as the landlord; the label names the key or code, never the code itself). Standing door codes are read from `lock_member_code` beside them rather than copied, and their sync state shows above them on the Building access view of Practice space (#2766). Held now / History tabs. Guarded by `lock.manage`
