import { SqlReportPage } from '@/components/SqlReportPage';

// "Managers" in the original cpanel = users with the management-equivalent
// role. In this org's u_UserTypeMaster the available roles are
// Salesman / Tech / Ops; "Ops" is the management-equivalent.
export default function Managers() {
  return (
    <SqlReportPage
      title="Managers"
      subtitle="Users with role 'Ops' (management-equivalent)"
      sql={`SELECT u.UserId, u.UserName, u.InternalId, u.StoreId, u.Active, t.Description AS Role,
                   u.AddDateTime, u.UpdateDateTime
            FROM u_UserMaster u
            INNER JOIN u_UserTypeMaster t ON u.UserTypeId = t.UserTypeId
            WHERE LOWER(ISNULL(t.Description, '')) IN ('ops', 'manager', 'admin')
            ORDER BY u.UserId`}
      filename="managers.csv"
      emptyText="No users with management role."
    />
  );
}
