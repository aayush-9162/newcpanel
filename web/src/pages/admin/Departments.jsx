import { SqlReportPage } from '@/components/SqlReportPage';

// Departments aren't a top-level table in our schema dump; the closest is the
// user-type master which categorizes users by role.
export default function Departments() {
  return (
    <SqlReportPage
      title="Departments / User Types"
      subtitle="u_UserTypeMaster"
      sql="SELECT * FROM u_UserTypeMaster ORDER BY 1"
      filename="departments.csv"
    />
  );
}
