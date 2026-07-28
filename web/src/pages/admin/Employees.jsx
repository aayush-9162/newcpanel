import { SqlReportPage } from '@/components/SqlReportPage';

// All staff with their role joined in.
export default function Employees() {
  return (
    <SqlReportPage
      title="Employees"
      subtitle="All users with role"
      sql={`SELECT u.UserId, u.UserName, u.InternalId, u.StoreId, u.Active, t.Description AS Role,
                   u.AddDateTime, u.UpdateDateTime
            FROM u_UserMaster u
            LEFT JOIN u_UserTypeMaster t ON u.UserTypeId = t.UserTypeId
            ORDER BY t.Description, u.UserName`}
      filename="employees.csv"
    />
  );
}
