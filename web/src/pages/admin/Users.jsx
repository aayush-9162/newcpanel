import { SqlReportPage } from '@/components/SqlReportPage';

export default function Users() {
  return (
    <SqlReportPage
      title="Users"
      subtitle="u_UserMaster · all users with role"
      sql={`SELECT u.UserId, u.UserName, u.InternalId, u.StoreId, u.Active, t.Description AS Role,
                   u.AddDateTime, u.UpdateDateTime
            FROM u_UserMaster u
            LEFT JOIN u_UserTypeMaster t ON u.UserTypeId = t.UserTypeId
            ORDER BY u.UserId`}
      filename="users.csv"
    />
  );
}
